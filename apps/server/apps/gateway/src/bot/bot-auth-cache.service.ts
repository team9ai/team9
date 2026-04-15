import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '@team9/redis';

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
  context: BotAuthContext | null;
  expiresAt: number;
  botId: string | null;
}

@Injectable()
export class BotAuthCacheService {
  private readonly positiveTtlSeconds = 30;
  private readonly negativeTtlSeconds = 5;
  private readonly mutationTtlSeconds = 30;
  private readonly inflight = new Map<string, Promise<BotAuthContext | null>>();

  // ── L1 in-memory cache ──────────────────────────────────────────────
  // Sits in front of Redis to eliminate network round-trips on hot paths
  // (every bot-scoped API request currently makes a token lookup). TTL is
  // intentionally short — across multiple gateway instances, a
  // bot-mutation on one node can only evict this node's L1; other nodes
  // serve stale context until their own entry expires. 5s keeps the
  // stale window bounded without sacrificing hit rate on active bots.
  private readonly memoryTtlMs = 5_000;
  private readonly negativeMemoryTtlMs = 1_000;
  private readonly memoryCacheMaxSize = 2_000;
  private readonly memoryCache = new Map<string, MemoryCacheEntry>();
  private readonly memoryByBotId = new Map<string, Set<string>>();

  constructor(private readonly redis: RedisService) {}

  async getOrSetValidation(
    rawToken: string,
    loader: () => Promise<BotAuthContext | VersionedBotAuthContext | null>,
  ): Promise<BotAuthContext | null> {
    const cacheKey = this.cacheKey(rawToken);

    // L1 check: bypass Redis entirely if we have a fresh in-memory entry.
    // Mutation-in-progress is not re-checked here — beginBotMutation
    // evicts this node's L1 for the bot, so a stale entry can only exist
    // if the mutation happened on another node. That window is bounded
    // by memoryTtlMs (5s).
    const memoryHit = this.readMemory(cacheKey);
    if (memoryHit.hit) {
      return memoryHit.context;
    }

    const existing = this.inflight.get(cacheKey);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      const cached = await this.safeGet(cacheKey);
      const cachedContext = await this.getValidCachedContext(cacheKey, cached);
      if (cachedContext !== undefined) {
        this.writeMemory(cacheKey, cachedContext);
        return cachedContext;
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
        }
        this.writeMemory(cacheKey, versioned.context);
        return versioned.context;
      }

      await this.safeSet(
        cacheKey,
        JSON.stringify({ invalid: true }),
        this.negativeTtlSeconds,
      );
      this.writeMemory(cacheKey, null);
      return null;
    })();

    this.inflight.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(cacheKey);
    }
  }

  async invalidateBot(botId: string): Promise<void> {
    this.evictMemoryByBotId(botId);
    await this.bumpBotVersion(botId);

    const reverseIndexKey = this.reverseIndexKey(botId);
    const keys = await this.safeSmembers(reverseIndexKey);
    for (const key of keys) {
      await this.safeDel(key);
    }
    await this.safeDel(reverseIndexKey);
  }

  async beginBotMutation(botId: string): Promise<void> {
    this.evictMemoryByBotId(botId);
    await this.redis.set(this.mutationKey(botId), '1', this.mutationTtlSeconds);
  }

  async endBotMutation(botId: string): Promise<void> {
    await this.safeDel(this.mutationKey(botId));
  }

  async isBotMutationInProgress(botId: string): Promise<boolean> {
    try {
      return (await this.redis.exists(this.mutationKey(botId))) > 0;
    } catch {
      return false;
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
    return `auth:bot-token:${createHash('sha256').update(rawToken).digest('hex')}`;
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
  ): Promise<BotAuthContext | null | undefined> {
    if (!cached.ok || cached.value === null) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(cached.value) as CachedBotAuthPayload;
      if ('invalid' in parsed) {
        return null;
      }

      if (!('context' in parsed)) {
        await this.safeDel(cacheKey);
        return undefined;
      }

      if (await this.isBotMutationInProgress(parsed.context.botId)) {
        return null;
      }

      const currentVersion = await this.getBotVersion(parsed.context.botId);
      if (currentVersion === null) {
        return undefined;
      }

      if (parsed.version !== currentVersion) {
        await this.safeDel(cacheKey);
        return undefined;
      }

      return parsed.context;
    } catch {
      return undefined;
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
  ): { hit: true; context: BotAuthContext | null } | { hit: false } {
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

  private writeMemory(cacheKey: string, context: BotAuthContext | null): void {
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

    const botId = context?.botId ?? null;
    const ttl = context ? this.memoryTtlMs : this.negativeMemoryTtlMs;
    this.memoryCache.set(cacheKey, {
      context,
      expiresAt: Date.now() + ttl,
      botId,
    });
    if (botId) {
      let set = this.memoryByBotId.get(botId);
      if (!set) {
        set = new Set();
        this.memoryByBotId.set(botId, set);
      }
      set.add(cacheKey);
    }
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
    if (!entry.botId) return;
    const set = this.memoryByBotId.get(entry.botId);
    if (!set) return;
    set.delete(cacheKey);
    if (set.size === 0) {
      this.memoryByBotId.delete(entry.botId);
    }
  }
}
