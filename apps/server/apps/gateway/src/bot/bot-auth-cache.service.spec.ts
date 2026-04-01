import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { RedisService } from '@team9/redis';
import { BotAuthCacheService } from './bot-auth-cache.service.js';

describe('BotAuthCacheService', () => {
  let service: BotAuthCacheService;
  let redis: {
    get: jest.Mock<any>;
    set: jest.Mock<any>;
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
    const value = { botId: 'bot-1', userId: 'user-1', tenantId: 'tenant-1' };

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
    resolveLoader?.({ botId: 'bot-2', userId: 'user-2', tenantId: 'tenant-2' });

    await expect(first).resolves.toEqual({
      botId: 'bot-2',
      userId: 'user-2',
      tenantId: 'tenant-2',
    });
    await expect(second).resolves.toEqual({
      botId: 'bot-2',
      userId: 'user-2',
      tenantId: 'tenant-2',
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('returns the loader result when Redis read and parse operations fail', async () => {
    redis.get.mockResolvedValueOnce('not-json');
    const value = { botId: 'bot-3', userId: 'user-3', tenantId: 'tenant-3' };
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

    const value = { botId: 'bot-4', userId: 'user-4', tenantId: 'tenant-4' };

    await expect(
      service.getOrSetValidation('t9bot_write_fail', async () => value),
    ).resolves.toEqual(value);
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

  it('treats a positive cache entry with an old bot version as stale after invalidation', async () => {
    const value = { botId: 'bot-7', userId: 'user-7', tenantId: 'tenant-7' };
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
});
