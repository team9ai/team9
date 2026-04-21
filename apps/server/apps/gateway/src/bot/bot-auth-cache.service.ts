import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '@team9/redis';

/**
 * Minimal subscriber shape we need from the ioredis client returned by
 * `RedisService.createSubscriber()`. Defining this locally avoids a hard
 * dep on `ioredis` from the gateway package — the redis lib already owns
 * that dependency.
 */
type BotAuthSubscriber = {
  on(
    event: 'message',
    listener: (channel: string, message: string) => void,
  ): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'close' | 'end' | 'ready', listener: () => void): unknown;
  removeAllListeners(event?: string): unknown;
  subscribe(...channels: string[]): Promise<unknown>;
  quit(): Promise<unknown>;
};

export interface BotAuthContext {
  botId: string;
  userId: string;
  tenantId: string;
  email: string;
  username: string;
}

interface VersionedBotAuthContext {
  context: BotAuthContext;
  version: number | null;
}

type SafeGetResult = { ok: true; value: string | null } | { ok: false };

type CachedBotAuthPayload =
  | { invalid: true }
  | VersionedBotAuthContext
  | BotAuthContext;

interface MemoryCacheEntry {
  context: BotAuthContext;
  expiresAt: number;
  botId: string;
}

/**
 * Result of checking the Redis-layer cache for a token. `cacheable: false`
 * means the null is transient (bot mutation in progress) — callers must not
 * promote it into the L1 memory cache or it will mask the completed
 * mutation for the L1 TTL window.
 */
interface CachedContextResult {
  context: BotAuthContext | null;
  cacheable: boolean;
}

/** Cross-node invalidation channel. */
const BOT_AUTH_INVALIDATE_CHANNEL = 'bot-auth:invalidate';

@Injectable()
export class BotAuthCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotAuthCacheService.name);

  private readonly positiveTtlSeconds = 30;
  private readonly negativeTtlSeconds = 5;
  private readonly mutationTtlSeconds = 30;
  private readonly inflight = new Map<
    string,
    {
      promise: Promise<BotAuthContext | null>;
      // Captured at the moment the inflight load STARTED. Subsequent
      // callers that share this promise must validate the result
      // against THESE values (not their own), because the promise's
      // result was effectively computed "as of" the original start.
      startEra: number;
      startSeq: number;
    }
  >();

  // ── L1 in-memory cache ──────────────────────────────────────────────
  // Positive-only in-memory cache in front of Redis. Eliminates network
  // round-trips on hot paths (every bot-scoped API request hits the token
  // lookup). Cross-node correctness is handled by Redis pub/sub: any node
  // mutating or invalidating a bot publishes the botId, and subscribers
  // evict their local L1 entries for that bot. TTL is kept short (5s) as
  // a second line of defense against lost pub/sub messages.
  //
  // Negative results are never cached here. Redis already caches them for
  // negativeTtlSeconds (5s), and caching negatives locally would (a) let
  // an invalid-token flood evict hot positive entries from the bounded
  // slot count, and (b) risk masking mutation-in-progress transient nulls
  // for the full L1 TTL.
  private readonly memoryTtlMs = 5_000;
  private readonly memoryCacheMaxSize = 2_000;
  private readonly memoryCache = new Map<string, MemoryCacheEntry>();
  private readonly memoryByBotId = new Map<string, Set<string>>();

  // ── Race/era coordination for L1 writes ─────────────────────────────
  // A monotonic sequence stamped on every in-flight load start and every
  // invalidation (local or pub/sub-delivered). writeMemory rejects a
  // positive whose captured start-seq is older than the latest
  // invalidate-seq for that bot — even if the request was still fetching
  // when the invalidation landed.
  //
  // An era counter is bumped every time the pub/sub subscriber becomes
  // healthy (initial connect + every reconnect). Requests captured in a
  // previous era — i.e. potentially served under a period when we were
  // missing invalidations — are rejected at write time regardless of
  // sequence, covering the disconnect/reconnect window.
  //
  // The sequence map is NEVER pruned. Bounded by distinct bot count in
  // practice (thousands); ~40 B per entry; and pruning would reopen the
  // race on long-lived in-flight requests.
  private l1Era = 0;
  private l1Seq = 0;
  private readonly invalidateSeqs = new Map<string, number>();

  // Per-bot ref-count of mutations currently in progress on THIS node.
  // Updated synchronously by beginBotMutation / endBotMutation.
  // writeMemory refuses to populate L1 for any bot with count > 0,
  // regardless of seq — this closes a same-node race where a request
  // started before the begin call's `await redis.set(mutationKey)` could
  // otherwise see "no mutation flag" in Redis and stash a stale positive
  // into L1 in the window between recordInvalidation and the actual
  // Redis state change. Ref-counting (rather than a Set) is required so
  // overlapping same-bot mutations keep the flag asserted until the
  // outermost end call releases it. The cross-node case is still handled
  // by Redis mutationKey + version fence + pub/sub eviction.
  //
  // Safety assumption: every `beginBotMutation(botId)` caller must pair
  // with a matching `endBotMutation(botId)`, typically in a try/finally.
  // The only caller today (`replaceAccessTokenAndInvalidate`) honors this.
  // A dangling begin would permanently disable L1 promotion for the bot
  // until process restart — not a correctness hazard, but a perf one.
  private readonly localMutationRefCounts = new Map<string, number>();

  private subscriber: BotAuthSubscriber | null = null;
  private l1CrossNodeReady = false;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('[DEBUG/BA] onModuleInit enter');
    let createdSubscriber: BotAuthSubscriber | null = null;
    try {
      createdSubscriber = this.redis.createSubscriber() as BotAuthSubscriber;
      this.logger.log(
        `[DEBUG/BA] subscriber created status=${(createdSubscriber as unknown as { status?: string }).status}`,
      );
      createdSubscriber.on(
        'message',
        (channel: string, message: string): void => {
          if (channel === BOT_AUTH_INVALIDATE_CHANNEL && message) {
            this.recordInvalidation(message);
          }
        },
      );
      // Runtime disconnect / broken-pipe / protocol errors: drop L1
      // entirely until the connection recovers.
      createdSubscriber.on('error', (err: Error) => {
        this.logger.warn(
          `Bot auth invalidate subscriber error: ${err.message} — disabling L1`,
        );
        this.disableL1();
      });
      createdSubscriber.on('close', () => {
        this.logger.warn(
          'Bot auth invalidate subscriber closed — disabling L1',
        );
        this.disableL1();
      });
      createdSubscriber.on('end', () => {
        this.logger.warn('Bot auth invalidate subscriber ended — disabling L1');
        this.disableL1();
      });
      this.logger.log('[DEBUG/BA] calling subscribe');
      await createdSubscriber.subscribe(BOT_AUTH_INVALIDATE_CHANNEL);
      this.logger.log('[DEBUG/BA] subscribed');
      // ONLY wire the `'ready'` handler AFTER the initial subscribe has
      // succeeded. ioredis auto-restores subscriptions on reconnect, so
      // a successfully-subscribed channel survives a disconnect. But if
      // the INITIAL subscribe rejects, we must not let a later `'ready'`
      // event flip the L1 cache back on — we would be serving stale L1
      // data while silently missing invalidations for a channel we are
      // not actually subscribed to.
      createdSubscriber.on('ready', () => {
        this.enableL1AfterSubscribe('reconnect');
      });
      this.subscriber = createdSubscriber;
      this.enableL1AfterSubscribe('initial');
    } catch (err) {
      // Subscribe failed. Tear down the partially-wired subscriber so
      // no lingering listener can re-enable L1 later. Falling back to
      // Redis-only is strictly less performant but strictly safer.
      if (createdSubscriber) {
        try {
          createdSubscriber.removeAllListeners();
          await createdSubscriber.quit();
        } catch {
          // Best-effort teardown.
        }
      }
      this.subscriber = null;
      this.disableL1();
      this.logger.warn(
        `Failed to subscribe to ${BOT_AUTH_INVALIDATE_CHANNEL}; L1 positive cache disabled: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private enableL1AfterSubscribe(trigger: 'initial' | 'reconnect'): void {
    // Bump the era counter. Any in-flight getOrSetValidation captured
    // under an older era will be rejected at write time, so a request
    // that started before an outage cannot repopulate L1 after reconnect.
    this.l1Era += 1;
    // Purge L1 on reconnect. We potentially missed invalidations during
    // the outage, so pre-outage entries are all suspect. invalidateSeqs
    // is intentionally preserved — era + seq together handle both the
    // outage-straddling and mid-load races.
    this.memoryCache.clear();
    this.memoryByBotId.clear();
    this.l1CrossNodeReady = true;
    if (trigger === 'reconnect') {
      this.logger.log(
        'Bot auth invalidate subscriber ready — L1 positive cache enabled',
      );
    }
  }

  private disableL1(): void {
    this.l1CrossNodeReady = false;
    this.memoryCache.clear();
    this.memoryByBotId.clear();
    // Keep invalidateSeqs — they remain meaningful in the next era via
    // the era check; losing them would let a pre-outage request write
    // stale data after reconnect if no fresh invalidation arrives.
  }

  /**
   * Record an invalidation (local or pub/sub-delivered). Bumps the
   * monotonic sequence and stamps it against the bot, then evicts any
   * existing L1 entries. writeMemory consults invalidateSeqs to reject
   * in-flight loader writes whose start-seq predates the invalidation.
   */
  private recordInvalidation(botId: string): void {
    this.l1Seq += 1;
    this.invalidateSeqs.set(botId, this.l1Seq);
    this.evictMemoryByBotId(botId);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.subscriber) return;
    try {
      // Remove ALL listeners so a final 'close' / 'end' / 'ready' /
      // 'error' event during the quit sequence cannot flip L1 state or
      // trigger a spurious re-enable.
      this.subscriber.removeAllListeners();
      await this.subscriber.quit();
    } catch {
      // Best-effort shutdown.
    } finally {
      this.subscriber = null;
      this.l1CrossNodeReady = false;
    }
  }

  async getOrSetValidation(
    rawToken: string,
    loader: () => Promise<BotAuthContext | VersionedBotAuthContext | null>,
  ): Promise<BotAuthContext | null> {
    const cacheKey = this.cacheKey(rawToken);

    // L1 check: bypass Redis entirely if we have a fresh in-memory entry.
    // Cross-node consistency is maintained via pub/sub — any node that
    // mutates or invalidates a bot broadcasts on BOT_AUTH_INVALIDATE_CHANNEL
    // and subscribers evict their local entry. If cross-node wiring is
    // down (subscribe failed), we never enter this branch because
    // writeMemory refuses to populate the cache.
    const memoryHit = this.readMemory(cacheKey);
    if (memoryHit.hit) {
      return memoryHit.context;
    }

    const existing = this.inflight.get(cacheKey);
    if (existing) {
      const shared = await existing.promise;
      // Null results are safe to share without re-validation: bot
      // access-token validity is monotonic on the wire. A raw t9bot_
      // token hashes to a single access_token row; once that row is
      // invalidated (rotated, revoked, or the bot deleted), the same
      // raw string can never be reissued because new tokens are
      // generated from 48 bytes of fresh randomness. "Valid → invalid"
      // is the only legal transition, so reusing a cached null can
      // never erroneously authenticate a later request.
      if (shared === null) return null;
      // Re-validate the shared positive against the ORIGINAL inflight
      // start-epoch (not this caller's). An invalidation that landed
      // after the inflight promise was created marks the result stale
      // for anyone sharing it. Using the caller's own startSeq would
      // miss this case when the caller arrives after the invalidation
      // has already been stamped.
      if (
        !this.isResultStaleForCaller(
          shared,
          existing.startEra,
          existing.startSeq,
        )
      ) {
        return shared;
      }
      // Shared result is stale. Fall through to a fresh load for this
      // caller. The current caller now captures its own era/seq. We
      // deliberately do NOT overwrite the inflight map entry — another
      // concurrent caller may still be legitimately waiting on the
      // original promise.
      const freshStartEra = this.l1Era;
      const freshStartSeq = this.l1Seq;
      return this.runValidationLoader(
        cacheKey,
        loader,
        freshStartEra,
        freshStartSeq,
      );
    }

    // No inflight entry — this caller creates one. Capture its own
    // start-epoch and register it alongside the promise so later callers
    // that share the entry can validate against the correct snapshot.
    const startEra = this.l1Era;
    const startSeq = this.l1Seq;
    const promise = this.runValidationLoader(
      cacheKey,
      loader,
      startEra,
      startSeq,
    );

    this.inflight.set(cacheKey, { promise, startEra, startSeq });
    try {
      return await promise;
    } finally {
      this.inflight.delete(cacheKey);
    }
  }

  private async runValidationLoader(
    cacheKey: string,
    loader: () => Promise<BotAuthContext | VersionedBotAuthContext | null>,
    startEra: number,
    startSeq: number,
  ): Promise<BotAuthContext | null> {
    const cached = await this.safeGet(cacheKey);
    const cachedResult = await this.getValidCachedContext(cacheKey, cached);
    if (cachedResult !== undefined) {
      // Only promote to L1 when the cached result is stable. Transient
      // "mutation in progress" nulls must stay out of the positive L1
      // (they are not cacheable at all) and invalid markers are also
      // skipped — see the class-level rationale for why negatives stay
      // Redis-only.
      if (cachedResult.cacheable && cachedResult.context !== null) {
        this.writeMemory(cacheKey, cachedResult.context, startEra, startSeq);
      }
      return cachedResult.context;
    }

    const result = await loader();
    if (result) {
      const versioned = await this.resolveVersionedContext(result);
      if (versioned.version !== null) {
        const reverseIndexKey = this.reverseIndexKey(versioned.context.botId);
        await this.safeSet(
          cacheKey,
          JSON.stringify(versioned),
          this.positiveTtlSeconds,
        );
        await this.safeSadd(reverseIndexKey, cacheKey);
        await this.safeExpire(reverseIndexKey, this.positiveTtlSeconds);
        // Only promote to L1 when we were able to read the bot version
        // from Redis. A null version means the Redis version lookup
        // failed, so we have no fencing against a concurrent
        // invalidation — L1 must not be populated either (consistent
        // with the Redis-write skip above).
        this.writeMemory(cacheKey, versioned.context, startEra, startSeq);
      }
      return versioned.context;
    }

    await this.safeSet(
      cacheKey,
      JSON.stringify({ invalid: true }),
      this.negativeTtlSeconds,
    );
    // Negative results are never stored in L1 — see class-level comment.
    return null;
  }

  /**
   * Returns true when a result from another caller's inflight promise
   * cannot be safely reused for the current caller — i.e. the L1 era
   * has advanced, the bot is currently mid-mutation, or an invalidation
   * for this bot was stamped after the current caller's request start.
   */
  private isResultStaleForCaller(
    result: BotAuthContext,
    startEra: number,
    startSeq: number,
  ): boolean {
    if (startEra !== this.l1Era) return true;
    if ((this.localMutationRefCounts.get(result.botId) ?? 0) > 0) return true;
    const lastSeq = this.invalidateSeqs.get(result.botId);
    if (lastSeq !== undefined && lastSeq > startSeq) return true;
    return false;
  }

  async invalidateBot(botId: string): Promise<void> {
    // Stamp seq + evict locally before publishing. The pub/sub message
    // we broadcast will also reach this node's subscriber and stamp
    // again — that double-stamp only moves the seq forward, which is
    // safe (more aggressive rejection of in-flight writes).
    this.recordInvalidation(botId);
    await this.bumpBotVersion(botId);

    const reverseIndexKey = this.reverseIndexKey(botId);
    const keys = await this.safeSmembers(reverseIndexKey);
    for (const key of keys) {
      await this.safeDel(key);
    }
    await this.safeDel(reverseIndexKey);

    // Tell other gateway nodes to drop their L1 entries for this bot.
    // Best-effort: if Redis pub/sub is down, the Redis-layer version bump
    // above still serves as the authoritative fence on other nodes' next
    // read, so losing the broadcast only widens the local-L1 staleness
    // window to memoryTtlMs (5s) on those nodes.
    await this.broadcastInvalidation(botId);
  }

  async beginBotMutation(botId: string): Promise<void> {
    // Ref-count the bot as mid-mutation synchronously. writeMemory
    // consults this map on every L1 positive write and refuses for any
    // bot with count > 0 — this prevents a same-node request that
    // started before the mutation flag hit Redis from stashing a stale
    // positive into L1. Ref-counting lets overlapping same-bot mutations
    // compose correctly: the outermost end call is the one that releases.
    this.incrementMutationRef(botId);
    try {
      this.recordInvalidation(botId);
      await this.redis.set(
        this.mutationKey(botId),
        '1',
        this.mutationTtlSeconds,
      );
      await this.broadcastInvalidation(botId);
    } catch (err) {
      // On failure we must not leave the bot permanently blocked from
      // L1 promotion — the caller will typically retry or fall through.
      this.decrementMutationRef(botId);
      throw err;
    }
  }

  async endBotMutation(botId: string): Promise<void> {
    try {
      await this.safeDel(this.mutationKey(botId));
    } finally {
      // Always decrement the local ref-count, even on Redis cleanup
      // failure. Leaving the count stuck would silently disable L1 for
      // the bot until process restart.
      this.decrementMutationRef(botId);
    }
  }

  private incrementMutationRef(botId: string): void {
    const current = this.localMutationRefCounts.get(botId) ?? 0;
    this.localMutationRefCounts.set(botId, current + 1);
  }

  private decrementMutationRef(botId: string): void {
    const current = this.localMutationRefCounts.get(botId);
    if (current === undefined) return;
    if (current <= 1) {
      this.localMutationRefCounts.delete(botId);
    } else {
      this.localMutationRefCounts.set(botId, current - 1);
    }
  }

  /**
   * Check whether a rotation/revocation is in progress for `botId`.
   *
   * The error-handling policy is caller-dependent:
   *
   * - `onError: 'open'` (default) — return `false` on Redis error. This
   *   is the right choice for the DB-loader path (findValidatedAccessTokenMatch
   *   in bot.service.ts), which uses the flag as an early-skip
   *   optimization. The DB is still authoritative there, so failing
   *   open only costs an extra bcrypt compare, not correctness.
   *
   * - `onError: 'closed'` — return `true` on Redis error. This is the
   *   right choice for the cache-serving path (getValidCachedContext),
   *   where we are about to authenticate a request from a cached
   *   positive. Failing open there would let a stale cached token
   *   survive a concurrent token rotation during a Redis blip: cached
   *   entry is still version-valid, the mutation-flag check is silently
   *   skipped, and the revoked credentials authenticate successfully.
   */
  async isBotMutationInProgress(
    botId: string,
    opts: { onError?: 'open' | 'closed' } = {},
  ): Promise<boolean> {
    try {
      return (await this.redis.exists(this.mutationKey(botId))) > 0;
    } catch (err) {
      const onError = opts.onError ?? 'open';
      this.logger.warn(
        `isBotMutationInProgress Redis error for ${botId} (failing ${onError}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return onError === 'closed';
    }
  }

  async getBotVersion(botId: string): Promise<number | null> {
    const raw = await this.safeGet(this.versionKey(botId));
    if (!raw.ok) {
      return null;
    }

    if (raw.value === null) {
      return 0;
    }

    const parsed = Number.parseInt(raw.value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private cacheKey(rawToken: string): string {
    // v2 prefix: BotAuthContext shape gained email/username in the commit
    // that introduced this comment. Older v1 entries (without those
    // fields) must not be read back — they would produce JwtPayloads
    // with undefined email/username downstream. Bumping the prefix lets
    // old entries expire naturally (positive TTL = 30s) with no manual
    // migration.
    return `auth:bot-token:v2:${createHash('sha256').update(rawToken).digest('hex')}`;
  }

  private reverseIndexKey(botId: string): string {
    return `auth:bot-token-keys:${botId}`;
  }

  private versionKey(botId: string): string {
    return `auth:bot-token-version:${botId}`;
  }

  private mutationKey(botId: string): string {
    return `auth:bot-token-mutation:${botId}`;
  }

  private async getValidCachedContext(
    cacheKey: string,
    cached: SafeGetResult,
  ): Promise<CachedContextResult | undefined> {
    if (!cached.ok || cached.value === null) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(cached.value) as CachedBotAuthPayload;
      if ('invalid' in parsed) {
        return { context: null, cacheable: true };
      }

      if (!('context' in parsed)) {
        await this.safeDel(cacheKey);
        return undefined;
      }

      // Reject legacy entries missing the email/username fields added in
      // the v2 context shape. With the v2 prefix this is defense in depth
      // — if an old payload somehow surfaces (e.g. manual Redis edit), we
      // refuse to serve a half-populated context.
      if (
        typeof parsed.context.email !== 'string' ||
        typeof parsed.context.username !== 'string'
      ) {
        await this.safeDel(cacheKey);
        return undefined;
      }

      if (
        await this.isBotMutationInProgress(parsed.context.botId, {
          onError: 'closed',
        })
      ) {
        // Transient: do NOT cache this null into L1. The caller must
        // fall back to Redis again on the next request so it can see
        // the post-mutation state as soon as the flag clears.
        return { context: null, cacheable: false };
      }

      const currentVersion = await this.getBotVersion(parsed.context.botId);
      if (currentVersion === null) {
        return undefined;
      }

      if (parsed.version !== currentVersion) {
        await this.safeDel(cacheKey);
        return undefined;
      }

      return { context: parsed.context, cacheable: true };
    } catch {
      return undefined;
    }
  }

  /**
   * Broadcast a bot invalidation to other gateway nodes so they drop their
   * L1 entries for this bot. Best-effort — callers must not rely on
   * delivery for correctness; the L1 TTL is the backstop.
   */
  private async broadcastInvalidation(botId: string): Promise<void> {
    try {
      await this.redis.publish(BOT_AUTH_INVALIDATE_CHANNEL, botId);
    } catch (err) {
      this.logger.warn(
        `Failed to broadcast bot auth invalidation for ${botId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async resolveVersionedContext(
    result: BotAuthContext | VersionedBotAuthContext,
  ): Promise<VersionedBotAuthContext> {
    if ('context' in result) {
      return result;
    }

    return {
      context: result,
      version: await this.getBotVersion(result.botId),
    };
  }

  private async safeGet(key: string): Promise<SafeGetResult> {
    try {
      return {
        ok: true,
        value: await this.redis.get(key),
      };
    } catch {
      return { ok: false };
    }
  }

  private async safeSet(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redis.set(key, value, ttlSeconds);
    } catch {
      // Best-effort cache write.
    }
  }

  private async safeSadd(key: string, member: string): Promise<void> {
    try {
      await this.redis.sadd(key, member);
    } catch {
      // Best-effort reverse index maintenance.
    }
  }

  private async safeExpire(key: string, seconds: number): Promise<void> {
    try {
      await this.redis.expire(key, seconds);
    } catch {
      // Best-effort reverse index maintenance.
    }
  }

  private async safeSmembers(key: string): Promise<string[]> {
    try {
      return await this.redis.smembers(key);
    } catch {
      return [];
    }
  }

  private async safeDel(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch {
      // Best-effort invalidation.
    }
  }

  private async bumpBotVersion(botId: string): Promise<number> {
    return this.redis.incr(this.versionKey(botId));
  }

  // ── L1 memory-cache helpers ─────────────────────────────────────────

  private readMemory(
    cacheKey: string,
  ): { hit: true; context: BotAuthContext } | { hit: false } {
    if (!this.l1CrossNodeReady) {
      return { hit: false };
    }
    const entry = this.memoryCache.get(cacheKey);
    if (!entry) {
      return { hit: false };
    }
    if (entry.expiresAt <= Date.now()) {
      this.deleteMemoryEntry(cacheKey, entry);
      return { hit: false };
    }
    return { hit: true, context: entry.context };
  }

  private writeMemory(
    cacheKey: string,
    context: BotAuthContext,
    startEra: number,
    startSeq: number,
  ): void {
    // Only promote to L1 when cross-node invalidation is wired up.
    // Without pub/sub, we have no way to evict stale entries on other
    // nodes during a token rotation, so the safe fallback is to disable
    // L1 positive caching entirely and let every request go through
    // Redis (which still has its own version-fenced cache).
    if (!this.l1CrossNodeReady) {
      return;
    }

    // Era guard: if the subscriber went through a disconnect/reconnect
    // cycle since this request started, we may have missed invalidations
    // during the outage. The era counter advanced on reconnect, so any
    // pre-outage in-flight request is rejected here.
    if (startEra !== this.l1Era) {
      return;
    }

    // Local-mutation guard: close the same-node begin/end window. The
    // seq guard alone is insufficient here because a request that
    // started before beginBotMutation called recordInvalidation, but
    // whose loader runs between recordInvalidation and the Redis
    // mutation-flag write, would otherwise see "no mutation flag" and
    // attempt to cache the positive. Ref-counted so overlapping same-bot
    // mutations keep the flag asserted until the outermost end.
    if ((this.localMutationRefCounts.get(context.botId) ?? 0) > 0) {
      return;
    }

    // Sequence guard: if an invalidation for this bot was recorded with
    // a higher seq than the request's start-seq, the value we are about
    // to cache could be stale. The next request will fall through to
    // Redis, which is fenced by bot version.
    const lastSeq = this.invalidateSeqs.get(context.botId);
    if (lastSeq !== undefined && lastSeq > startSeq) {
      return;
    }

    // Evict an existing entry under the same key to keep the botId
    // reverse index in sync before rewriting.
    const existing = this.memoryCache.get(cacheKey);
    if (existing) {
      this.deleteMemoryEntry(cacheKey, existing);
    }

    // Bound memory usage. Insertion-order eviction approximates LRU
    // well enough for short TTLs — entries churn within seconds.
    while (this.memoryCache.size >= this.memoryCacheMaxSize) {
      const oldestKey = this.memoryCache.keys().next().value as
        | string
        | undefined;
      if (!oldestKey) break;
      const oldestEntry = this.memoryCache.get(oldestKey);
      if (oldestEntry) {
        this.deleteMemoryEntry(oldestKey, oldestEntry);
      } else {
        this.memoryCache.delete(oldestKey);
      }
    }

    this.memoryCache.set(cacheKey, {
      context,
      expiresAt: Date.now() + this.memoryTtlMs,
      botId: context.botId,
    });
    let set = this.memoryByBotId.get(context.botId);
    if (!set) {
      set = new Set();
      this.memoryByBotId.set(context.botId, set);
    }
    set.add(cacheKey);
  }

  private evictMemoryByBotId(botId: string): void {
    const keys = this.memoryByBotId.get(botId);
    if (!keys) return;
    for (const key of keys) {
      this.memoryCache.delete(key);
    }
    this.memoryByBotId.delete(botId);
  }

  private deleteMemoryEntry(cacheKey: string, entry: MemoryCacheEntry): void {
    this.memoryCache.delete(cacheKey);
    const set = this.memoryByBotId.get(entry.botId);
    if (!set) return;
    set.delete(cacheKey);
    if (set.size === 0) {
      this.memoryByBotId.delete(entry.botId);
    }
  }
}
