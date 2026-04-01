import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { RedisService } from '@team9/redis';
import { BotAuthCacheService } from './bot-auth-cache.service.js';

describe('BotAuthCacheService', () => {
  let service: BotAuthCacheService;
  const redis = {
    get: jest.fn<any>().mockResolvedValue(null),
    set: jest.fn<any>().mockResolvedValue('OK'),
    sadd: jest.fn<any>().mockResolvedValue(1),
    smembers: jest.fn<any>().mockResolvedValue([]),
    expire: jest.fn<any>().mockResolvedValue(1),
    del: jest.fn<any>().mockResolvedValue(1),
  };

  beforeEach(async () => {
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
      JSON.stringify(value),
      30,
    );
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

  it('invalidates all cached token digests for a bot via the reverse index', async () => {
    redis.smembers.mockResolvedValue([
      'auth:bot-token:abc',
      'auth:bot-token:def',
    ]);

    await service.invalidateBot('bot-9');

    expect(redis.smembers).toHaveBeenCalledWith('auth:bot-token-keys:bot-9');
    expect(redis.del).toHaveBeenCalledWith(
      'auth:bot-token:abc',
      'auth:bot-token:def',
      'auth:bot-token-keys:bot-9',
    );
  });
});
