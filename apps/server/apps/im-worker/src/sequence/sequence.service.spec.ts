import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { SequenceService } from './sequence.service.js';

type MockFn = jest.Mock<(...args: any[]) => any>;

describe('SequenceService', () => {
  let service: SequenceService;
  let redisService: {
    exists: MockFn;
    incr: MockFn;
    get: MockFn;
    getClient: MockFn;
  };
  let db: {
    select: MockFn;
    from: MockFn;
    where: MockFn;
  };
  let setnxMock: MockFn;
  let incrbyMock: MockFn;

  beforeEach(() => {
    setnxMock = jest.fn<any>().mockResolvedValue(1);
    incrbyMock = jest.fn<any>().mockResolvedValue(15);

    redisService = {
      exists: jest.fn<any>().mockResolvedValue(1),
      incr: jest.fn<any>().mockResolvedValue(42),
      get: jest.fn<any>().mockResolvedValue('9'),
      getClient: jest.fn<any>().mockReturnValue({
        setnx: setnxMock,
        incrby: incrbyMock,
      }),
    };

    db = {
      select: jest.fn<any>().mockReturnThis(),
      from: jest.fn<any>().mockReturnThis(),
      where: jest.fn<any>().mockResolvedValue([{ maxSeq: '100' }]),
    };

    service = new SequenceService(redisService as any, db as any);
  });

  it('recovers missing channel seq from the database before incrementing', async () => {
    redisService.exists.mockResolvedValue(0);
    redisService.incr.mockResolvedValue(101);

    const result = await service.generateChannelSeq('channel-1');

    expect(db.select).toHaveBeenCalled();
    expect(setnxMock).toHaveBeenCalledWith('im:seq:channel:channel-1', '100');
    expect(redisService.incr).toHaveBeenCalledWith('im:seq:channel:channel-1');
    expect(result).toBe(BigInt(101));
  });

  it('continues incrementing even when channel seq recovery fails', async () => {
    redisService.exists.mockResolvedValue(0);
    db.where.mockRejectedValue(new Error('db down'));
    redisService.incr.mockResolvedValue(1);

    const result = await service.generateChannelSeq('channel-2');

    expect(redisService.incr).toHaveBeenCalledWith('im:seq:channel:channel-2');
    expect(result).toBe(BigInt(1));
  });

  it('increments user seq directly without touching the database', async () => {
    redisService.incr.mockResolvedValue(77);

    const result = await service.generateUserSeq('user-1');

    expect(redisService.incr).toHaveBeenCalledWith('im:seq:user:user-1');
    expect(db.select).not.toHaveBeenCalled();
    expect(result).toBe(BigInt(77));
  });

  it('returns the start and end range for batch channel sequence generation', async () => {
    const result = await service.generateChannelSeqBatch('channel-3', 5);

    expect(incrbyMock).toHaveBeenCalledWith('im:seq:channel:channel-3', 5);
    expect(result).toEqual({
      start: BigInt(11),
      end: BigInt(15),
    });
  });

  it('returns zero when current sequence is absent', async () => {
    redisService.get.mockResolvedValue(null);

    const result = await service.getCurrentSeq('channel', 'channel-4');

    expect(redisService.get).toHaveBeenCalledWith('im:seq:channel:channel-4');
    expect(result).toBe(BigInt(0));
  });

  it('reads the current user sequence from redis', async () => {
    redisService.get.mockResolvedValue('88');

    const result = await service.getCurrentSeq('user', 'user-2');

    expect(redisService.get).toHaveBeenCalledWith('im:seq:user:user-2');
    expect(result).toBe(BigInt(88));
  });
});
