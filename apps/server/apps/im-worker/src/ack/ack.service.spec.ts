import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockEq = jest.fn((field: unknown, value: unknown) => ({
  kind: 'eq',
  field,
  value,
}));
const mockAnd = jest.fn((...conditions: unknown[]) => ({
  kind: 'and',
  conditions,
}));

jest.unstable_mockModule('@team9/database', () => ({
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: mockEq,
  and: mockAnd,
}));

jest.unstable_mockModule('@team9/database/schemas', () => ({
  messageAcks: {
    messageId: 'message_acks.messageId',
    userId: 'message_acks.userId',
  },
  userChannelReadStatus: {
    userId: 'user_channel_read_status.userId',
    channelId: 'user_channel_read_status.channelId',
  },
}));

jest.unstable_mockModule('@team9/redis', () => ({
  RedisService: class RedisService {},
}));

jest.unstable_mockModule('@team9/shared', () => ({
  MQ_CONFIG: {
    ACK_TIMEOUT: 30_000,
  },
  env: {},
}));

const { AckService } = await import('./ack.service.js');
const schema = await import('@team9/database/schemas');

function createDbMock() {
  const insertChain = {
    values: jest.fn<any>().mockReturnThis(),
    onConflictDoUpdate: jest.fn<any>().mockResolvedValue(undefined),
  };
  const selectChain = {
    from: jest.fn<any>().mockReturnThis(),
    where: jest.fn<any>().mockReturnThis(),
    limit: jest.fn<any>().mockResolvedValue([]),
  };

  return {
    insert: jest.fn<any>().mockReturnValue(insertChain),
    select: jest.fn<any>().mockReturnValue(selectChain),
    insertChain,
    selectChain,
  };
}

function createRedisMock() {
  const client = {
    zadd: jest.fn<any>().mockResolvedValue(1),
    zrem: jest.fn<any>().mockResolvedValue(1),
    zrangebyscore: jest.fn<any>().mockResolvedValue([]),
  };

  return {
    getClient: jest.fn(() => client),
    client,
  };
}

describe('AckService', () => {
  let service: AckService;
  let db: ReturnType<typeof createDbMock>;
  let redisService: ReturnType<typeof createRedisMock>;

  beforeEach(() => {
    jest.clearAllMocks();
    db = createDbMock();
    redisService = createRedisMock();
    service = new AckService(db as any, redisService as any);
  });

  it('marks delivered ACKs and removes them from the pending queue', async () => {
    const debugSpy = jest
      .spyOn((service as any).logger, 'debug')
      .mockImplementation(() => undefined);

    await service.handleClientAck({
      userId: 'user-1',
      message: {
        targetId: 'channel-1',
        payload: {
          msgId: 'msg-1',
          ackType: 'delivered',
        },
      },
    } as any);

    expect(db.insert).toHaveBeenCalledWith(schema.messageAcks);
    expect(db.insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-1',
        userId: 'user-1',
        status: 'delivered',
        deliveredAt: expect.any(Date),
      }),
    );
    expect(redisService.client.zrem).toHaveBeenCalledWith(
      'im:pending_ack:user-1',
      'msg-1',
    );
    expect(debugSpy).toHaveBeenCalledWith(
      'Processed delivered ACK for message msg-1 from user user-1',
    );
  });

  it('marks read ACKs as read and stores the read timestamp', async () => {
    await service.handleClientAck({
      userId: 'user-2',
      message: {
        targetId: 'channel-1',
        payload: {
          msgId: 'msg-2',
          ackType: 'read',
        },
      },
    } as any);

    expect(db.insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-2',
        userId: 'user-2',
        status: 'read',
        readAt: expect.any(Date),
      }),
    );
  });

  it('swallows ACK processing failures and logs them', async () => {
    const errorSpy = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);
    db.insertChain.onConflictDoUpdate.mockRejectedValueOnce(
      new Error('db down'),
    );

    await expect(
      service.handleClientAck({
        userId: 'user-3',
        message: {
          targetId: 'channel-1',
          payload: {
            msgId: 'msg-3',
            ackType: 'delivered',
          },
        },
      } as any),
    ).resolves.toBeUndefined();

    expect(redisService.client.zrem).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to process ACK: Error: db down',
    );
  });

  it('upserts read status rows for channels', async () => {
    const debugSpy = jest
      .spyOn((service as any).logger, 'debug')
      .mockImplementation(() => undefined);

    await service.handleReadStatus({
      userId: 'user-1',
      message: {
        targetId: 'channel-9',
        payload: {
          lastReadMsgId: 'msg-9',
        },
      },
    } as any);

    expect(db.insert).toHaveBeenCalledWith(schema.userChannelReadStatus);
    expect(db.insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        channelId: 'channel-9',
        lastReadMessageId: 'msg-9',
        lastReadAt: expect.any(Date),
        unreadCount: 0,
      }),
    );
    expect(db.insertChain.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: [
          schema.userChannelReadStatus.userId,
          schema.userChannelReadStatus.channelId,
        ],
        set: expect.objectContaining({
          lastReadMessageId: 'msg-9',
          lastReadAt: expect.any(Date),
          unreadCount: 0,
        }),
      }),
    );
    expect(debugSpy).toHaveBeenCalledWith(
      'Updated read status for user user-1 in channel channel-9',
    );
  });

  it('adds, removes, and queries pending ACKs through Redis sorted sets', async () => {
    redisService.client.zrangebyscore.mockResolvedValue(['msg-1', 'msg-2']);

    await service.addToPending('user-4', 'msg-1', 123);
    await service.removeFromPending('user-4', 'msg-1');

    await expect(service.getPendingMessages('user-4', 500)).resolves.toEqual([
      'msg-1',
      'msg-2',
    ]);

    expect(redisService.client.zadd).toHaveBeenCalledWith(
      'im:pending_ack:user-4',
      123,
      'msg-1',
    );
    expect(redisService.client.zrem).toHaveBeenCalledWith(
      'im:pending_ack:user-4',
      'msg-1',
    );
    expect(redisService.client.zrangebyscore).toHaveBeenCalledWith(
      'im:pending_ack:user-4',
      0,
      expect.any(Number),
      'LIMIT',
      0,
      10,
    );
  });

  it('reports acknowledgment state from the database row status', async () => {
    db.selectChain.limit.mockResolvedValueOnce([{ status: 'delivered' }]);
    await expect(service.isAcknowledged('msg-1', 'user-1')).resolves.toBe(true);

    db.selectChain.limit.mockResolvedValueOnce([{ status: 'pending' }]);
    await expect(service.isAcknowledged('msg-1', 'user-1')).resolves.toBe(
      false,
    );

    db.selectChain.limit.mockResolvedValueOnce([]);
    await expect(service.isAcknowledged('msg-1', 'user-1')).resolves.toBe(
      false,
    );

    expect(mockAnd).toHaveBeenLastCalledWith(
      { kind: 'eq', field: schema.messageAcks.messageId, value: 'msg-1' },
      { kind: 'eq', field: schema.messageAcks.userId, value: 'user-1' },
    );
  });
});
