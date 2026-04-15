import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { RedisService } from '@team9/redis';
import {
  BotAuthCacheService,
  type BotAuthContext,
} from './bot-auth-cache.service.js';

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
  };

  beforeEach(async () => {
    redis = {
      get: jest.fn<any>().mockResolvedValue(null),
      set: jest.fn<any>().mockResolvedValue('OK'),
      exists: jest.fn<any>().mockResolvedValue(0),
      incr: jest.fn<any>().mockResolvedValue(1),
      sadd: jest.fn<any>().mockResolvedValue(1),
      smembers: jest.fn<any>().mockResolvedValue([]),
      expire: jest.fn<any>().mockResolvedValue(1),
      del: jest.fn<any>().mockResolvedValue(1),
    };
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        BotAuthCacheService,
        { provide: RedisService, useValue: redis },
      ],
    }).compile();
    service = module.get(BotAuthCacheService);
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
      expect.stringMatching(/^auth:bot-token:[a-f0-9]{64}$/),
      JSON.stringify({ context: value, version: 0 }),
      30,
    );
    expect(redis.get).toHaveBeenCalledWith('auth:bot-token-version:bot-1');
    expect(redis.sadd).toHaveBeenCalledWith(
      'auth:bot-token-keys:bot-1',
      expect.stringMatching(/^auth:bot-token:[a-f0-9]{64}$/),
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
      expect.stringMatching(/^auth:bot-token:[a-f0-9]{64}$/),
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

  it('caches negative results in L1 with a short TTL to dampen invalid-token floods', async () => {
    const loader = jest.fn<() => Promise<BotAuthContext | null>>(
      async () => null,
    );

    await service.getOrSetValidation('t9bot_l1_neg', loader);
    const redisCallsAfterFirst = redis.set.mock.calls.length;
    await service.getOrSetValidation('t9bot_l1_neg', loader);

    // Second lookup is L1 hit on the negative entry — loader only ran once,
    // and no additional Redis set happened.
    expect(loader).toHaveBeenCalledTimes(1);
    expect(redis.set.mock.calls.length).toBe(redisCallsAfterFirst);
  });
});
