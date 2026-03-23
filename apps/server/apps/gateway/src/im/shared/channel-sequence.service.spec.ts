import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { DATABASE_CONNECTION } from '@team9/database';
import { RedisService } from '@team9/redis';

// ── helpers ──────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

function mockDb() {
  const chain: Record<string, MockFn> = {};
  const methods = ['select', 'from', 'where'];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  // Default: DB returns maxSeq = '100'
  chain.where.mockResolvedValue([{ maxSeq: '100' }]);
  return chain;
}

// ── tests ─────────────────────────────────────────────────────────────

describe('ChannelSequenceService', () => {
  let service: any;
  let db: ReturnType<typeof mockDb>;
  let redisService: {
    incr: MockFn;
    exists: MockFn;
    getClient: MockFn;
  };
  let setnxMock: MockFn;

  beforeEach(async () => {
    db = mockDb();
    setnxMock = jest.fn<any>().mockResolvedValue(1);

    redisService = {
      incr: jest.fn<any>().mockResolvedValue(42),
      exists: jest.fn<any>().mockResolvedValue(1),
      getClient: jest.fn<any>().mockReturnValue({
        setnx: setnxMock,
      }),
    };

    const { ChannelSequenceService } =
      await import('./channel-sequence.service.js');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelSequenceService,
        { provide: RedisService, useValue: redisService },
        { provide: DATABASE_CONNECTION, useValue: db },
      ],
    }).compile();

    service = module.get(ChannelSequenceService);
  });

  // ── generateChannelSeq ────────────────────────────────────────────

  describe('generateChannelSeq', () => {
    it('should generate seqId via Redis INCR when key exists', async () => {
      // Redis key exists (exists returns truthy)
      redisService.exists.mockResolvedValue(1);
      redisService.incr.mockResolvedValue(42);

      const result = await service.generateChannelSeq('channel-abc');

      // Should check existence with correct key
      expect(redisService.exists).toHaveBeenCalledWith(
        'im:seq:channel:channel-abc',
      );
      // Should NOT do DB recovery when key exists
      expect(db.select).not.toHaveBeenCalled();
      expect(setnxMock).not.toHaveBeenCalled();
      // Should call incr with correct key
      expect(redisService.incr).toHaveBeenCalledWith(
        'im:seq:channel:channel-abc',
      );
      // Should return BigInt of the incr result
      expect(result).toBe(BigInt(42));
    });

    it('should recover from DB when Redis key is missing (calls setnx then incr)', async () => {
      // Redis key does NOT exist
      redisService.exists.mockResolvedValue(0);
      redisService.incr.mockResolvedValue(101);
      // DB returns maxSeq = '100'
      db.where.mockResolvedValue([{ maxSeq: '100' }]);

      const result = await service.generateChannelSeq('channel-xyz');

      // Should check existence
      expect(redisService.exists).toHaveBeenCalledWith(
        'im:seq:channel:channel-xyz',
      );
      // Should query DB for max seqId
      expect(db.select).toHaveBeenCalled();
      // Should call setnx with recovered value
      expect(redisService.getClient).toHaveBeenCalled();
      expect(setnxMock).toHaveBeenCalledWith(
        'im:seq:channel:channel-xyz',
        '100',
      );
      // Should then incr
      expect(redisService.incr).toHaveBeenCalledWith(
        'im:seq:channel:channel-xyz',
      );
      // Should return BigInt of the incr result
      expect(result).toBe(BigInt(101));
    });

    it('should catch DB recovery failure and continue with incr (does not throw)', async () => {
      // Redis key does NOT exist, triggering recovery
      redisService.exists.mockResolvedValue(0);
      // DB query throws
      db.where.mockRejectedValue(new Error('DB connection lost'));
      redisService.incr.mockResolvedValue(1);

      // Should NOT throw
      const result = await service.generateChannelSeq('channel-fail');

      // Recovery failed, but incr is still called
      expect(redisService.incr).toHaveBeenCalledWith(
        'im:seq:channel:channel-fail',
      );
      // Should still return a BigInt
      expect(result).toBe(BigInt(1));
    });
  });
});
