import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { DATABASE_CONNECTION } from '@team9/database';
import { RedisService } from '@team9/redis';

// ── helpers ──────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

function mockDb() {
  const chain: Record<string, MockFn> = {};
  const methods = [
    'select',
    'from',
    'where',
    'limit',
    'insert',
    'values',
    'returning',
    'update',
    'set',
    'innerJoin',
    'leftJoin',
    'orderBy',
    'offset',
    'groupBy',
    'having',
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.limit.mockResolvedValue([]);
  chain.returning.mockResolvedValue([]);
  return chain;
}

// ── tests ─────────────────────────────────────────────────────────────

describe('ChannelMemberCacheService', () => {
  let service: any;
  let db: ReturnType<typeof mockDb>;
  let redisService: {
    get: MockFn;
    set: MockFn;
    del: MockFn;
  };

  beforeEach(async () => {
    db = mockDb();

    redisService = {
      get: jest.fn<any>().mockResolvedValue(null),
      set: jest.fn<any>().mockResolvedValue('OK'),
      del: jest.fn<any>().mockResolvedValue(1),
    };

    const { ChannelMemberCacheService } =
      await import('./channel-member-cache.service.js');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelMemberCacheService,
        { provide: RedisService, useValue: redisService },
        { provide: DATABASE_CONNECTION, useValue: db },
      ],
    }).compile();

    service = module.get(ChannelMemberCacheService);
  });

  // ── getMemberIds ──────────────────────────────────────────────────

  describe('getMemberIds', () => {
    it('should return cached member IDs without querying DB on cache hit', async () => {
      const channelId = 'channel-abc';
      const memberIds = ['user-1', 'user-2', 'user-3'];
      redisService.get.mockResolvedValue(JSON.stringify(memberIds));

      const result = await service.getMemberIds(channelId);

      // Should check Redis with correct key
      expect(redisService.get).toHaveBeenCalledWith(
        `im:cache:channel_members:${channelId}`,
      );
      // Should NOT query DB on cache hit
      expect(db.select).not.toHaveBeenCalled();
      // Should return parsed member IDs
      expect(result).toEqual(memberIds);
    });

    it('should query DB and write to Redis with TTL 300 on cache miss', async () => {
      const channelId = 'channel-xyz';
      const dbRows = [{ userId: 'user-a' }, { userId: 'user-b' }];
      redisService.get.mockResolvedValue(null);
      // DB chain resolves the final .where() call
      db.where.mockResolvedValue(dbRows);

      const result = await service.getMemberIds(channelId);

      // Should check Redis first
      expect(redisService.get).toHaveBeenCalledWith(
        `im:cache:channel_members:${channelId}`,
      );
      // Should query DB with correct table
      expect(db.select).toHaveBeenCalled();
      expect(db.from).toHaveBeenCalled();
      expect(db.where).toHaveBeenCalled();
      // Should write result to Redis with TTL 300
      expect(redisService.set).toHaveBeenCalledWith(
        `im:cache:channel_members:${channelId}`,
        JSON.stringify(['user-a', 'user-b']),
        300,
      );
      // Should return mapped member IDs
      expect(result).toEqual(['user-a', 'user-b']);
    });

    it('should return empty array when channel has no active members', async () => {
      const channelId = 'channel-empty';
      redisService.get.mockResolvedValue(null);
      db.where.mockResolvedValue([]);

      const result = await service.getMemberIds(channelId);

      // Should still write empty array to Redis
      expect(redisService.set).toHaveBeenCalledWith(
        `im:cache:channel_members:${channelId}`,
        JSON.stringify([]),
        300,
      );
      expect(result).toEqual([]);
    });

    it('should throw exception and NOT write to Redis when DB query fails', async () => {
      const channelId = 'channel-fail';
      const dbError = new Error('DB connection lost');
      redisService.get.mockResolvedValue(null);
      db.where.mockRejectedValue(dbError);

      await expect(service.getMemberIds(channelId)).rejects.toThrow(
        'DB connection lost',
      );

      // Should NOT write anything to Redis on DB failure
      expect(redisService.set).not.toHaveBeenCalled();
    });

    it('should coalesce concurrent requests for uncached channel into single DB query', async () => {
      const channelId = 'channel-stampede';
      const dbRows = [{ userId: 'user-1' }, { userId: 'user-2' }];
      redisService.get.mockResolvedValue(null);

      // DB query is slow — use a promise that resolves after a tick
      let resolveDb: (value: any) => void;
      const dbPromise = new Promise((resolve) => {
        resolveDb = resolve;
      });
      db.where.mockReturnValue(dbPromise);

      // Fire 3 concurrent requests before DB resolves
      const p1 = service.getMemberIds(channelId);
      const p2 = service.getMemberIds(channelId);
      const p3 = service.getMemberIds(channelId);

      // Resolve DB
      resolveDb!(dbRows);

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

      // DB should only be queried ONCE despite 3 concurrent calls
      expect(db.select).toHaveBeenCalledTimes(1);
      // All callers should receive the same result
      expect(r1).toEqual(['user-1', 'user-2']);
      expect(r2).toEqual(['user-1', 'user-2']);
      expect(r3).toEqual(['user-1', 'user-2']);
    });
  });

  // ── invalidate ────────────────────────────────────────────────────

  describe('invalidate', () => {
    it('should delete Redis key for given channelId', async () => {
      const channelId = 'channel-to-invalidate';

      await service.invalidate(channelId);

      expect(redisService.del).toHaveBeenCalledWith(
        `im:cache:channel_members:${channelId}`,
      );
    });
  });
});
