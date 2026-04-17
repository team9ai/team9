import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { createHash } from 'crypto';
import { RedisService } from '@team9/redis';
import {
  BotAuthCacheService,
  type BotAuthContext,
} from './bot-auth-cache.service.js';

const CACHE_KEY_REGEX = /^auth:bot-token:v2:[a-f0-9]{64}$/;

function mkContext(overrides: Partial<BotAuthContext> = {}): BotAuthContext {
  return {
    botId: 'bot-default',
    userId: 'user-default',
    tenantId: 'tenant-default',
    email: 'bot-default@example.com',
    username: 'bot-default',
    ...overrides,
  };
}

describe('BotAuthCacheService', () => {
  let service: BotAuthCacheService;
  let redis: {
    get: jest.Mock<any>;
    set: jest.Mock<any>;
    exists: jest.Mock<any>;
    incr: jest.Mock<any>;
    sadd: jest.Mock<any>;
    smembers: jest.Mock<any>;
    expire: jest.Mock<any>;
    del: jest.Mock<any>;
    publish: jest.Mock<any>;
    createSubscriber: jest.Mock<any>;
  };
  let subscriber: {
    on: jest.Mock<any>;
    removeAllListeners: jest.Mock<any>;
    subscribe: jest.Mock<any>;
    quit: jest.Mock<any>;
  };
  let invalidateHandler:
    | ((channel: string, message: string) => void)
    | undefined;
  let errorHandler: ((err: Error) => void) | undefined;
  let readyHandler: (() => void) | undefined;
  let closeHandler: (() => void) | undefined;

  /** Simulate a pub/sub invalidate broadcast from another gateway node. */
  function deliverInvalidate(botId: string): void {
    invalidateHandler?.('bot-auth:invalidate', botId);
  }

  /** Simulate an ioredis subscriber disconnect. */
  function triggerSubscriberError(message = 'connection lost'): void {
    errorHandler?.(new Error(message));
  }

  /** Simulate ioredis subscriber reconnect completing. */
  function triggerSubscriberReady(): void {
    readyHandler?.();
  }

  beforeEach(async () => {
    invalidateHandler = undefined;
    errorHandler = undefined;
    readyHandler = undefined;
    closeHandler = undefined;
    subscriber = {
      on: jest.fn<any>((event: string, handler: any) => {
        if (event === 'message') invalidateHandler = handler;
        if (event === 'error') errorHandler = handler;
        if (event === 'ready') readyHandler = handler;
        if (event === 'close') closeHandler = handler;
      }),
      removeAllListeners: jest.fn<any>(),
      subscribe: jest.fn<any>().mockResolvedValue(['bot-auth:invalidate', 1]),
      quit: jest.fn<any>().mockResolvedValue('OK'),
    };
    redis = {
      get: jest.fn<any>().mockResolvedValue(null),
      set: jest.fn<any>().mockResolvedValue('OK'),
      exists: jest.fn<any>().mockResolvedValue(0),
      incr: jest.fn<any>().mockResolvedValue(1),
      sadd: jest.fn<any>().mockResolvedValue(1),
      smembers: jest.fn<any>().mockResolvedValue([]),
      expire: jest.fn<any>().mockResolvedValue(1),
      del: jest.fn<any>().mockResolvedValue(1),
      publish: jest.fn<any>().mockResolvedValue(1),
      createSubscriber: jest.fn<any>().mockReturnValue(subscriber),
    };
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        BotAuthCacheService,
        { provide: RedisService, useValue: redis },
      ],
    }).compile();
    service = module.get(BotAuthCacheService);
    // Test.createTestingModule().compile() does not call lifecycle hooks.
    // Run onModuleInit explicitly so the L1 subscriber is wired up and
    // l1CrossNodeReady=true (otherwise the L1 cache refuses all writes).
    await service.onModuleInit();
  });

  it('stores positive validation results under a sha256 token digest and registers the reverse index', async () => {
    const value = mkContext({
      botId: 'bot-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      email: 'bot-1@example.com',
      username: 'bot-1',
    });

    const result = await service.getOrSetValidation(
      't9bot_deadbeef',
      async () => value,
    );

    expect(result).toEqual(value);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(CACHE_KEY_REGEX),
      JSON.stringify({ context: value, version: 0 }),
      30,
    );
    expect(redis.get).toHaveBeenCalledWith('auth:bot-token-version:bot-1');
    expect(redis.sadd).toHaveBeenCalledWith(
      'auth:bot-token-keys:bot-1',
      expect.stringMatching(CACHE_KEY_REGEX),
    );
    expect(redis.expire).toHaveBeenCalledWith('auth:bot-token-keys:bot-1', 30);
  });

  it('stores invalid results with the short negative TTL', async () => {
    const result = await service.getOrSetValidation(
      't9bot_bad',
      async () => null,
    );

    expect(result).toBeNull();
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(CACHE_KEY_REGEX),
      JSON.stringify({ invalid: true }),
      5,
    );
  });

  it('coalesces concurrent requests for the same token into one loader call', async () => {
    let resolveLoader: ((value: BotAuthContext | null) => void) | undefined;
    const loader = jest.fn<() => Promise<BotAuthContext | null>>(
      () =>
        new Promise<BotAuthContext | null>((resolve) => {
          resolveLoader = resolve;
        }),
    );

    const first = service.getOrSetValidation('t9bot_shared', loader);
    const second = service.getOrSetValidation('t9bot_shared', loader);

    await new Promise((resolve) => setImmediate(resolve));
    const expected = mkContext({
      botId: 'bot-2',
      userId: 'user-2',
      tenantId: 'tenant-2',
    });
    resolveLoader?.(expected);

    await expect(first).resolves.toEqual(expected);
    await expect(second).resolves.toEqual(expected);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('returns null for positive cache hits while a bot mutation lock is active', async () => {
    const value = mkContext({
      botId: 'bot-locked',
      userId: 'user-locked',
      tenantId: 'tenant-locked',
    });

    redis.get.mockImplementation(async (key: string) => {
      if (key === 'auth:bot-token-version:bot-locked') {
        return '1';
      }
      return JSON.stringify({ context: value, version: 1 });
    });
    redis.exists.mockImplementation(async (key: string) =>
      key === 'auth:bot-token-mutation:bot-locked' ? 1 : 0,
    );

    await expect(
      service.getOrSetValidation('t9bot_locked', async () => value),
    ).resolves.toBeNull();
  });

  it('sets and clears a per-bot mutation lock', async () => {
    await service.beginBotMutation('bot-10');
    await service.endBotMutation('bot-10');

    expect(redis.set).toHaveBeenCalledWith(
      'auth:bot-token-mutation:bot-10',
      '1',
      30,
    );
    expect(redis.del).toHaveBeenCalledWith('auth:bot-token-mutation:bot-10');
  });

  it('returns the loader result when Redis read and parse operations fail', async () => {
    redis.get.mockResolvedValueOnce('not-json');
    const value = mkContext({
      botId: 'bot-3',
      userId: 'user-3',
      tenantId: 'tenant-3',
    });
    const loader = jest.fn<any>().mockResolvedValue(value);

    await expect(
      service.getOrSetValidation('t9bot_corrupt', loader),
    ).resolves.toEqual(value);

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('returns the loader result when Redis write operations fail', async () => {
    redis.set.mockRejectedValue(new Error('redis unavailable'));
    redis.sadd.mockRejectedValue(new Error('redis unavailable'));
    redis.expire.mockRejectedValue(new Error('redis unavailable'));

    const value = mkContext({
      botId: 'bot-4',
      userId: 'user-4',
      tenantId: 'tenant-4',
    });

    await expect(
      service.getOrSetValidation('t9bot_write_fail', async () => value),
    ).resolves.toEqual(value);
  });

  it('skips L1 promotion when the bot version cannot be read from Redis (matches the Redis-write skip)', async () => {
    // Regression guard: the loader path used to write L1 regardless of
    // whether the Redis-layer positive write was skipped for version
    // reasons. That left L1 populated without a version fence, so a
    // concurrent invalidation that bumped the version could not cause
    // the L1 entry to expire. The fix only promotes to L1 when the
    // Redis positive write also went through.
    const value = mkContext({
      botId: 'bot-version-null-l1',
      userId: 'user-version-null-l1',
      tenantId: 'tenant-version-null-l1',
    });

    redis.get.mockImplementation(async (key: string) => {
      if (key === 'auth:bot-token-version:bot-version-null-l1') {
        throw new Error('redis unavailable');
      }
      return null;
    });

    const loader = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => value,
    );

    await service.getOrSetValidation('t9bot_version_null', loader);
    // Re-running the loader should be required because L1 was not
    // populated.
    redis.get.mockImplementation(async () => null);
    await service.getOrSetValidation('t9bot_version_null', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('defaults isBotMutationInProgress to fail-OPEN (loader path must not DoS on Redis blip)', async () => {
    // Regression guard: findValidatedAccessTokenMatch in bot.service.ts
    // uses isBotMutationInProgress as an early-skip optimization. The
    // default behavior must remain fail-open so that a Redis blip does
    // not cause ALL bot auth to fail — the DB is still authoritative
    // for the token match in that path.
    redis.exists.mockRejectedValueOnce(new Error('redis blip'));
    await expect(
      service.isBotMutationInProgress('bot-fail-open-default'),
    ).resolves.toBe(false);
  });

  it('fail-closed branch of isBotMutationInProgress is opt-in', async () => {
    redis.exists.mockRejectedValueOnce(new Error('redis blip'));
    await expect(
      service.isBotMutationInProgress('bot-fail-closed-explicit', {
        onError: 'closed',
      }),
    ).resolves.toBe(true);
  });

  it('skips positive cache writes when the bot version cannot be read from Redis', async () => {
    const value = mkContext({
      botId: 'bot-version-read-fail',
      userId: 'user-5',
      tenantId: 'tenant-5',
    });

    redis.get.mockImplementation(async (key: string) => {
      if (key === 'auth:bot-token-version:bot-version-read-fail') {
        throw new Error('redis unavailable');
      }
      return null;
    });

    await expect(
      service.getOrSetValidation('t9bot_version_read_fail', async () => value),
    ).resolves.toEqual(value);

    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.sadd).not.toHaveBeenCalled();
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('invalidates all cached token digests for a bot via the reverse index', async () => {
    redis.smembers.mockResolvedValue([
      'auth:bot-token:abc',
      'auth:bot-token:def',
    ]);

    await service.invalidateBot('bot-9');

    expect(redis.incr).toHaveBeenCalledWith('auth:bot-token-version:bot-9');
    expect(redis.smembers).toHaveBeenCalledWith('auth:bot-token-keys:bot-9');
    expect(redis.del.mock.calls).toEqual([
      ['auth:bot-token:abc'],
      ['auth:bot-token:def'],
      ['auth:bot-token-keys:bot-9'],
    ]);
  });

  it('throws when the authoritative bot auth version bump fails', async () => {
    redis.incr.mockRejectedValueOnce(new Error('redis down'));

    await expect(service.invalidateBot('bot-bump-fail')).rejects.toThrow(
      'redis down',
    );

    expect(redis.smembers).not.toHaveBeenCalled();
  });

  it('treats a positive cache entry with an old bot version as stale after invalidation', async () => {
    const value = mkContext({
      botId: 'bot-7',
      userId: 'user-7',
      tenantId: 'tenant-7',
    });
    let version = 0;
    const entries = new Map<string, string>();

    redis.get.mockImplementation(async (key: string) => {
      if (key === 'auth:bot-token-version:bot-7') {
        return String(version);
      }
      return entries.get(key) ?? null;
    });
    redis.set.mockImplementation(async (key: string, payload: string) => {
      entries.set(key, payload);
      return 'OK';
    });
    redis.incr.mockImplementation(async (key: string) => {
      if (key === 'auth:bot-token-version:bot-7') {
        version += 1;
        return version;
      }
      return 1;
    });
    redis.sadd.mockImplementation(async () => 1);

    const loader = jest.fn(async () => value);
    const token = 't9bot_versioned';

    await expect(service.getOrSetValidation(token, loader)).resolves.toEqual(
      value,
    );
    expect(loader).toHaveBeenCalledTimes(1);

    await service.invalidateBot('bot-7');

    const staleKey = redis.set.mock.calls[0]?.[0] as string;
    entries.set(staleKey, JSON.stringify({ context: value, version: 0 }));

    loader.mockResolvedValueOnce(null);

    await expect(service.getOrSetValidation(token, loader)).resolves.toBeNull();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(redis.del).toHaveBeenCalledWith(staleKey);
  });

  it('keeps invalidation best-effort after the version bump succeeds', async () => {
    redis.smembers.mockRejectedValueOnce(new Error('smembers failed'));
    redis.del.mockRejectedValue(new Error('del failed'));

    await expect(
      service.invalidateBot('bot-best-effort'),
    ).resolves.toBeUndefined();

    expect(redis.incr).toHaveBeenCalledWith(
      'auth:bot-token-version:bot-best-effort',
    );
  });

  // ── L1 in-memory cache ─────────────────────────────────────────────

  it('serves repeat token lookups from L1 memory cache without hitting Redis', async () => {
    const value = mkContext({ botId: 'bot-l1', userId: 'user-l1' });
    const loader = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => value,
    );

    const first = await service.getOrSetValidation('t9bot_l1', loader);
    expect(first).toEqual(value);
    expect(loader).toHaveBeenCalledTimes(1);
    const redisGetCallsAfterFirst = redis.get.mock.calls.length;

    const second = await service.getOrSetValidation('t9bot_l1', loader);
    expect(second).toEqual(value);
    expect(loader).toHaveBeenCalledTimes(1);
    // Second call must not touch Redis at all — L1 short-circuits.
    expect(redis.get.mock.calls.length).toBe(redisGetCallsAfterFirst);
  });

  it('invalidateBot evicts L1 entries for that bot so the next call re-validates', async () => {
    const value = mkContext({ botId: 'bot-l1-invalidate' });
    const loader = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => value,
    );

    await service.getOrSetValidation('t9bot_l1_inv', loader);
    expect(loader).toHaveBeenCalledTimes(1);

    redis.smembers.mockResolvedValueOnce([]);
    await service.invalidateBot('bot-l1-invalidate');

    await service.getOrSetValidation('t9bot_l1_inv', loader);
    // Loader ran again — L1 was evicted, so we fell through to Redis+loader.
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('beginBotMutation evicts L1 entries for that bot locally', async () => {
    const value = mkContext({ botId: 'bot-l1-mutation' });
    const loader = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => value,
    );

    await service.getOrSetValidation('t9bot_l1_mut', loader);
    expect(loader).toHaveBeenCalledTimes(1);

    await service.beginBotMutation('bot-l1-mutation');

    await service.getOrSetValidation('t9bot_l1_mut', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('expires L1 entries after the memory TTL so stale contexts do not leak forever', async () => {
    const value = mkContext({ botId: 'bot-l1-ttl' });
    const loader = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => value,
    );

    const realNow = Date.now;
    let current = 1_000_000;
    Date.now = () => current;

    try {
      await service.getOrSetValidation('t9bot_l1_ttl', loader);
      expect(loader).toHaveBeenCalledTimes(1);

      // Within TTL — L1 hit.
      current += 4_000;
      await service.getOrSetValidation('t9bot_l1_ttl', loader);
      expect(loader).toHaveBeenCalledTimes(1);

      // Past TTL — L1 miss, Redis path re-invoked.
      current += 10_000;
      await service.getOrSetValidation('t9bot_l1_ttl', loader);
      expect(loader).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = realNow;
    }
  });

  it('never writes negative results into L1 — negatives stay Redis-only', async () => {
    // Invalid-token floods would otherwise evict hot positive entries from
    // the bounded L1 slot count, and an L1 negative could also mask a
    // still-valid token during a transient window. The Redis layer has its
    // own short negative TTL (5s) which is enough back-pressure.
    const loader = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => null,
    );

    await service.getOrSetValidation('t9bot_l1_neg', loader);
    // Simulate the Redis negative marker so the second call sees a stable
    // answer without re-running the loader — we want to prove L1 does NOT
    // satisfy the read, not that the loader runs twice.
    redis.get.mockResolvedValueOnce(JSON.stringify({ invalid: true }));
    await service.getOrSetValidation('t9bot_l1_neg', loader);

    // Second call must touch Redis (L1 never stored the negative). The
    // loader count does not matter here — Redis is authoritative for
    // invalid markers and answers before the loader runs.
    expect(redis.get).toHaveBeenCalled();
    // And the second call must NOT have caused an L1 positive write back
    // — nothing in the spec assertions below depends on it, but we prove
    // it by checking that a third call also falls through to Redis.
    redis.get.mockResolvedValueOnce(JSON.stringify({ invalid: true }));
    await service.getOrSetValidation('t9bot_l1_neg', loader);
    expect(redis.get).toHaveBeenCalledTimes(3);
  });

  // ── pub/sub cross-node invalidation ─────────────────────────────────

  it('subscribes to bot-auth:invalidate during onModuleInit', () => {
    expect(redis.createSubscriber).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledWith('bot-auth:invalidate');
  });

  it('evicts L1 entries when another node broadcasts a bot invalidation', async () => {
    const value = mkContext({ botId: 'bot-remote-evict' });
    const loader = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => value,
    );

    await service.getOrSetValidation('t9bot_remote_evict', loader);
    expect(loader).toHaveBeenCalledTimes(1);

    // Simulate a remote gateway node broadcasting on the invalidate channel.
    deliverInvalidate('bot-remote-evict');

    await service.getOrSetValidation('t9bot_remote_evict', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('invalidateBot broadcasts the botId for cross-node L1 eviction', async () => {
    redis.smembers.mockResolvedValueOnce([]);
    await service.invalidateBot('bot-broadcast');
    expect(redis.publish).toHaveBeenCalledWith(
      'bot-auth:invalidate',
      'bot-broadcast',
    );
  });

  it('beginBotMutation also broadcasts so other nodes evict before the mutation completes', async () => {
    await service.beginBotMutation('bot-mutation-broadcast');
    expect(redis.publish).toHaveBeenCalledWith(
      'bot-auth:invalidate',
      'bot-mutation-broadcast',
    );
  });

  it('swallows pub/sub publish errors — L1 TTL is the backstop', async () => {
    redis.publish.mockRejectedValueOnce(new Error('publish failed'));
    redis.smembers.mockResolvedValueOnce([]);
    await expect(
      service.invalidateBot('bot-publish-fail'),
    ).resolves.toBeUndefined();
  });

  it('disables the L1 positive cache when the pub/sub subscriber fails to initialise', async () => {
    // Build a second service instance whose subscribe() rejects.
    const failingSubscriber = {
      on: jest.fn<any>(),
      removeAllListeners: jest.fn<any>(),
      subscribe: jest.fn<any>().mockRejectedValue(new Error('no pubsub')),
      quit: jest.fn<any>().mockResolvedValue('OK'),
    };
    const failingRedis = {
      ...redis,
      createSubscriber: jest.fn<any>().mockReturnValue(failingSubscriber),
    };
    const module = await Test.createTestingModule({
      providers: [
        BotAuthCacheService,
        { provide: RedisService, useValue: failingRedis },
      ],
    }).compile();
    const fallbackService = module.get(BotAuthCacheService);
    await fallbackService.onModuleInit();

    const value = mkContext({ botId: 'bot-fallback' });
    const loader = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => value,
    );

    await fallbackService.getOrSetValidation('t9bot_fallback', loader);
    await fallbackService.getOrSetValidation('t9bot_fallback', loader);

    // Without L1, both calls must run the loader (Redis mock returns null
    // for the cache key, so there is no L2 hit either).
    expect(loader).toHaveBeenCalledTimes(2);

    // Defense in depth: the failed subscriber must have been torn down so
    // a subsequent spurious 'ready' event cannot re-enable L1 without ever
    // having subscribed to the invalidate channel.
    expect(failingSubscriber.removeAllListeners).toHaveBeenCalled();
    expect(failingSubscriber.quit).toHaveBeenCalled();
  });

  it('does NOT wire the ready handler until the initial subscribe resolves (avoids silent re-enable after failed subscribe)', async () => {
    // Regression guard: if onModuleInit installed the 'ready' listener
    // before the initial subscribe succeeded, a failed subscribe would
    // still leave a live 'ready' handler that could flip L1 back on
    // later via ioredis auto-reconnect — while the channel was never
    // actually subscribed to, silently dropping invalidations.
    const readyHandlers: Array<() => void> = [];
    const flakySubscriber = {
      on: jest.fn<any>((event: string, handler: any) => {
        if (event === 'ready') readyHandlers.push(handler);
      }),
      removeAllListeners: jest.fn<any>(),
      subscribe: jest.fn<any>().mockRejectedValue(new Error('no pubsub')),
      quit: jest.fn<any>().mockResolvedValue('OK'),
    };
    const flakyRedis = {
      ...redis,
      createSubscriber: jest.fn<any>().mockReturnValue(flakySubscriber),
    };
    const module = await Test.createTestingModule({
      providers: [
        BotAuthCacheService,
        { provide: RedisService, useValue: flakyRedis },
      ],
    }).compile();
    const svc = module.get(BotAuthCacheService);
    await svc.onModuleInit();

    // The 'ready' handler was never registered (subscribe rejected first).
    expect(readyHandlers).toHaveLength(0);
  });

  it('does not promote transient mutation-in-progress nulls into L1', async () => {
    // Pre-populate the Redis layer with a valid cached context (version 0)
    // and simulate a mutation flag being set. The first call should see
    // cacheable=false (transient null), NOT write L1. The second call —
    // after the mutation flag clears — must therefore fall through to
    // Redis and return the still-valid positive context.
    const value = mkContext({ botId: 'bot-mutation-transient' });
    let mutationInProgress = true;
    const cachedKey = `auth:bot-token:v2:${createHash('sha256')
      .update('t9bot_mutation_transient')
      .digest('hex')}`;
    redis.get.mockImplementation(async (key: string) => {
      if (key === 'auth:bot-token-version:bot-mutation-transient') return '0';
      if (key === cachedKey)
        return JSON.stringify({ context: value, version: 0 });
      return null;
    });
    redis.exists.mockImplementation(async (key: string) =>
      key === 'auth:bot-token-mutation:bot-mutation-transient' &&
      mutationInProgress
        ? 1
        : 0,
    );

    const loader = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => value,
    );

    // Mutation in progress → transient null, L1 must NOT be populated.
    await expect(
      service.getOrSetValidation('t9bot_mutation_transient', loader),
    ).resolves.toBeNull();

    // Mutation ends; still-valid Redis entry becomes visible again.
    // If the transient null had been cached in L1, this would stay null.
    mutationInProgress = false;
    await expect(
      service.getOrSetValidation('t9bot_mutation_transient', loader),
    ).resolves.toEqual(value);
  });

  it('does not write a stale positive into L1 when an invalidation arrives mid-load', async () => {
    // Reproduces the in-flight race: node B starts a request, hits L1 miss,
    // begins fetching. While the loader is still running, node A broadcasts
    // invalidateBot(X). On B, the pub/sub handler evicts nothing (cache is
    // empty) but must stamp the invalidate epoch, so B's writeMemory on the
    // stale positive is rejected.
    const value = mkContext({ botId: 'bot-race' });
    let resolveLoader: ((v: BotAuthContext | null) => void) | undefined;
    const loader = jest.fn<() => Promise<BotAuthContext | null>>(
      () =>
        new Promise<BotAuthContext | null>((resolve) => {
          resolveLoader = resolve;
        }),
    );

    const inflight = service.getOrSetValidation('t9bot_race', loader);

    // Give the loader microtask time to start.
    await new Promise((r) => setImmediate(r));

    // A pub/sub message arrives for this bot BEFORE the loader resolves.
    // There is nothing in L1 yet, so eviction is a no-op — but the
    // invalidation epoch is recorded so the pending write gets rejected.
    deliverInvalidate('bot-race');

    resolveLoader?.(value);
    await expect(inflight).resolves.toEqual(value);

    // The next request must NOT be served from L1 — the stale write was
    // rejected. A fresh loader call proves it.
    const secondLoader = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => value,
    );
    await service.getOrSetValidation('t9bot_race', secondLoader);
    expect(secondLoader).toHaveBeenCalledTimes(1);
  });

  it('disables L1 on subscriber error and re-enables it on reconnect', async () => {
    const value = mkContext({ botId: 'bot-resilience' });
    const loader = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => value,
    );

    // Warm L1 under a healthy subscriber.
    await service.getOrSetValidation('t9bot_resilience', loader);
    expect(loader).toHaveBeenCalledTimes(1);

    // Subscriber disconnects. L1 must be invalidated until reconnect, so
    // the next read falls through to the loader again.
    triggerSubscriberError('ECONNRESET');
    await service.getOrSetValidation('t9bot_resilience', loader);
    expect(loader).toHaveBeenCalledTimes(2);

    // Even with a would-be L1 write during the outage, nothing sticks.
    await service.getOrSetValidation('t9bot_resilience', loader);
    expect(loader).toHaveBeenCalledTimes(3);

    // Reconnect — L1 comes back online and starts fresh (no inherited
    // pre-outage entries, since we may have missed invalidations).
    triggerSubscriberReady();
    await service.getOrSetValidation('t9bot_resilience', loader);
    expect(loader).toHaveBeenCalledTimes(4);

    // A follow-up request now hits L1 (the loader that just ran wrote it).
    await service.getOrSetValidation('t9bot_resilience', loader);
    expect(loader).toHaveBeenCalledTimes(4);
  });

  it('disables L1 when the subscriber connection closes', async () => {
    const value = mkContext({ botId: 'bot-close' });
    const loader = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => value,
    );

    await service.getOrSetValidation('t9bot_close', loader);
    expect(loader).toHaveBeenCalledTimes(1);

    closeHandler?.();

    await service.getOrSetValidation('t9bot_close', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('rejects an in-flight write whose request started in a previous era (pre-outage)', async () => {
    // Models a request that began before a subscriber outage, was held
    // in flight while the subscriber went error → ready, and tried to
    // write a stale positive after reconnect. Era guard must reject.
    const value = mkContext({ botId: 'bot-era-race' });
    let resolveLoader: ((v: BotAuthContext | null) => void) | undefined;
    const loader = jest.fn<() => Promise<BotAuthContext | null>>(
      () =>
        new Promise<BotAuthContext | null>((resolve) => {
          resolveLoader = resolve;
        }),
    );

    const inflight = service.getOrSetValidation('t9bot_era_race', loader);
    await new Promise((r) => setImmediate(r));

    // Subscriber dies while the loader is still pending.
    triggerSubscriberError('disconnected mid-load');
    // Subscriber reconnects — era advances.
    triggerSubscriberReady();

    // Loader resolves AFTER the era bump. Its captured startEra is now
    // older than current l1Era, so writeMemory must drop the result.
    resolveLoader?.(value);
    await expect(inflight).resolves.toEqual(value);

    // Next request must NOT be served from L1.
    const followup = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => value,
    );
    await service.getOrSetValidation('t9bot_era_race', followup);
    expect(followup).toHaveBeenCalledTimes(1);
  });

  it('keeps the race guard intact for an arbitrarily long-lived in-flight request', async () => {
    // Regression guard for the round-3 finding: a time-based epoch could
    // be pruned after a few seconds, re-opening the race for slow loaders.
    // The seq/era guard has no time component — even a request whose
    // loader is pending across many other invalidations must still be
    // rejected at write time.
    const value = mkContext({ botId: 'bot-slow' });
    let resolveLoader: ((v: BotAuthContext | null) => void) | undefined;
    const loader = jest.fn<() => Promise<BotAuthContext | null>>(
      () =>
        new Promise<BotAuthContext | null>((resolve) => {
          resolveLoader = resolve;
        }),
    );

    const inflight = service.getOrSetValidation('t9bot_slow', loader);
    await new Promise((r) => setImmediate(r));

    // Stamp the slow bot's invalidation seq, then churn through many
    // other invalidations to advance l1Seq far past the slow bot's seq.
    deliverInvalidate('bot-slow');
    for (let i = 0; i < 1_000; i += 1) {
      deliverInvalidate(`bot-other-${i}`);
    }

    resolveLoader?.(value);
    await expect(inflight).resolves.toEqual(value);

    // Despite the long delay and intervening churn, the slow bot's L1
    // entry must not have been written.
    const followup = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => value,
    );
    await service.getOrSetValidation('t9bot_slow', followup);
    expect(followup).toHaveBeenCalledTimes(1);
  });

  it('refuses L1 writes for any bot currently in beginBotMutation on this node (same-node race)', async () => {
    // Same-node race: a request's loader runs between beginBotMutation's
    // recordInvalidation and its `await redis.set(mutationKey)`. Without
    // localMutationInProgress, the request would capture a startSeq at
    // or after the new invalidate seq and still successfully promote the
    // positive to L1 because the Redis mutation flag was not yet visible.
    const value = mkContext({ botId: 'bot-begin-race' });

    // Put the bot into mid-mutation; do NOT await end.
    const beginPromise = service.beginBotMutation('bot-begin-race');

    // The loader runs while the mutation is in progress. Its write must
    // be rejected even though the seq guard alone might not catch it.
    const loader = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => value,
    );
    await service.getOrSetValidation('t9bot_begin_race', loader);

    await beginPromise;
    await service.endBotMutation('bot-begin-race');

    // After endBotMutation, the next request must still hit the loader
    // (nothing got stashed in L1 during the mutation window).
    const followup = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => value,
    );
    await service.getOrSetValidation('t9bot_begin_race', followup);
    expect(followup).toHaveBeenCalledTimes(1);
  });

  it('forces a fresh load for a second caller when an invalidation lands while the inflight promise is pending', async () => {
    // Scenario: caller A starts before an invalidation, caller B arrives
    // after. Without the inflight re-validation, B would silently await
    // A's pre-invalidation result. With the fix, B captures its own
    // era/seq before the inflight check, detects the invalidation, and
    // runs a fresh loader instead of reusing A's stale result.
    const olderContext = mkContext({
      botId: 'bot-inflight-race',
      email: 'old@example.com',
    });
    const newerContext = mkContext({
      botId: 'bot-inflight-race',
      email: 'new@example.com',
    });

    let resolveA: ((v: BotAuthContext | null) => void) | undefined;
    const loaderA = jest.fn<() => Promise<BotAuthContext | null>>(
      () =>
        new Promise<BotAuthContext | null>((resolve) => {
          resolveA = resolve;
        }),
    );
    const loaderB = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => newerContext,
    );

    // A starts first, establishes the inflight promise.
    const aPromise = service.getOrSetValidation('t9bot_inflight', loaderA);
    await new Promise((r) => setImmediate(r));

    // Invalidation for the bot arrives while A is still pending.
    deliverInvalidate('bot-inflight-race');

    // B arrives. Must NOT silently reuse A's promise. It should either
    // re-validate and reject, or fall through to a fresh loader.
    const bPromise = service.getOrSetValidation('t9bot_inflight', loaderB);

    // Resolve A with the (now-stale) older context.
    resolveA?.(olderContext);

    // A gets its own result back (may be stale for A, but A cannot
    // observe its own invalidation retroactively — correctness for A is
    // upstream's concern).
    await expect(aPromise).resolves.toEqual(olderContext);

    // B must see the fresh result, NOT the stale shared inflight value.
    await expect(bPromise).resolves.toEqual(newerContext);
    expect(loaderB).toHaveBeenCalledTimes(1);
  });

  it('ref-counts overlapping same-bot mutations so L1 stays blocked until the outermost end call', async () => {
    // Two concurrent beginBotMutation(X) calls. After the first matching
    // end, the second mutation is still notionally in progress. A
    // request landing in that window must NOT populate L1 — the
    // ref-count must still be > 0.
    const value = mkContext({ botId: 'bot-overlap' });

    await service.beginBotMutation('bot-overlap');
    await service.beginBotMutation('bot-overlap');

    // First end — count drops from 2 to 1.
    await service.endBotMutation('bot-overlap');

    // Write during the still-active second mutation must be rejected.
    const loader = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => value,
    );
    await service.getOrSetValidation('t9bot_overlap_1', loader);

    // Second end — count drops to 0, bot is no longer mid-mutation.
    await service.endBotMutation('bot-overlap');

    // A follow-up request must still hit the loader (nothing was
    // stashed in L1 during the mutation window).
    const followup = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => value,
    );
    await service.getOrSetValidation('t9bot_overlap_1', followup);
    expect(followup).toHaveBeenCalledTimes(1);
  });

  it('fails CLOSED when isBotMutationInProgress cannot reach Redis (treats blip as mutation-in-progress)', async () => {
    // Regression guard: if exists() throws, we must treat the bot as
    // mid-rotation and refuse to serve any cached positive. Failing
    // open would authenticate a potentially revoked token during a
    // Redis blip — the cached context could still be present even
    // though a rotation was in progress on another node.
    const value = mkContext({ botId: 'bot-blip' });

    redis.get.mockImplementation(async (key: string) => {
      if (key === 'auth:bot-token-version:bot-blip') return '0';
      if (key.startsWith('auth:bot-token:v2:'))
        return JSON.stringify({ context: value, version: 0 });
      return null;
    });
    redis.exists.mockRejectedValue(new Error('redis blip'));

    const loader = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => value,
    );

    // Cached positive + exists() rejected → transient null, NOT a stale
    // positive promotion.
    await expect(
      service.getOrSetValidation('t9bot_blip', loader),
    ).resolves.toBeNull();

    // And the L1 must not have been populated either.
    redis.exists.mockRejectedValue(new Error('redis blip'));
    await expect(
      service.getOrSetValidation('t9bot_blip', loader),
    ).resolves.toBeNull();
  });

  it('rejects legacy Redis entries that are missing the v2 email/username fields', async () => {
    // Defense-in-depth for the v2 prefix migration — if a legacy-shaped
    // payload somehow appears under the v2 key, we should delete it and
    // fall through to the loader instead of serving a JwtPayload with
    // undefined email/username.
    const legacyContext = {
      botId: 'bot-legacy',
      userId: 'user-legacy',
      tenantId: 'tenant-legacy',
    };
    redis.get.mockImplementation(async (key: string) => {
      if (key === 'auth:bot-token-version:bot-legacy') return '0';
      if (key.startsWith('auth:bot-token:v2:'))
        return JSON.stringify({ context: legacyContext, version: 0 });
      return null;
    });

    const reloaded = mkContext({ botId: 'bot-legacy' });
    const loader = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => reloaded,
    );

    await expect(
      service.getOrSetValidation('t9bot_legacy', loader),
    ).resolves.toEqual(reloaded);
    expect(loader).toHaveBeenCalledTimes(1);
    // Legacy entry was deleted during the fall-through.
    expect(redis.del).toHaveBeenCalledWith(
      expect.stringMatching(CACHE_KEY_REGEX),
    );
  });
});
