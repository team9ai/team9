import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { MessageService } from './message.service.js';
import { MessageRouterService } from './message-router.service.js';
import { SequenceService } from '../sequence/sequence.service.js';
import { RedisService } from '@team9/redis';
import { DATABASE_CONNECTION } from '@team9/database';

describe('MessageService', () => {
  let service: MessageService;

  const mockMessage = {
    id: 'msg-123',
    channelId: 'channel-456',
    senderId: 'user-789',
    content: 'Hello world',
    type: 'text',
    seqId: BigInt(100),
    clientMsgId: 'client-msg-1',
    parentId: null,
    createdAt: new Date(),
    isDeleted: false,
  };

  // Helper to create a chainable mock that resolves to data when awaited
  const createQueryMock = (resolveData: any) => {
    const queryMock: any = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      then: (resolve: any) => resolve(resolveData),
    };
    // Make all methods return the mock itself for chaining
    Object.keys(queryMock).forEach((key) => {
      if (key !== 'then' && typeof queryMock[key] === 'function') {
        queryMock[key].mockReturnValue(queryMock);
      }
    });
    return queryMock;
  };

  beforeEach(async () => {
    const mockRedisClient = {
      lpush: jest.fn().mockResolvedValue(1),
      ltrim: jest.fn().mockResolvedValue('OK'),
      pipeline: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageService,
        {
          provide: DATABASE_CONNECTION,
          useValue: {}, // Will be replaced per test
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            expire: jest.fn(),
            getClient: jest.fn().mockReturnValue(mockRedisClient),
          },
        },
        {
          provide: SequenceService,
          useValue: {
            generateChannelSeq: jest.fn().mockResolvedValue(BigInt(1)),
          },
        },
        {
          provide: MessageRouterService,
          useValue: {
            routeMessage: jest
              .fn()
              .mockResolvedValue({ online: [], offline: [] }),
          },
        },
      ],
    }).compile();

    service = module.get<MessageService>(MessageService);
  });

  describe('getUndeliveredMessages', () => {
    it('should return empty array when no unread status', async () => {
      // Create mock that returns empty array for read status query
      const mockDb = createQueryMock([]);
      (service as any).db = mockDb;

      const result = await service.getUndeliveredMessages('user-123');

      expect(result).toEqual([]);
    });

    it('should return unread messages for user', async () => {
      let callCount = 0;
      const mockDb: any = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: (resolve: any) => {
          callCount++;
          if (callCount === 1) {
            // First query: read status
            return resolve([
              {
                channelId: 'channel-456',
                lastReadMessageId: null,
                unreadCount: 2,
              },
            ]);
          } else {
            // Second query: messages
            return resolve([mockMessage]);
          }
        },
      };
      Object.keys(mockDb).forEach((key) => {
        if (key !== 'then' && typeof mockDb[key] === 'function') {
          mockDb[key].mockReturnValue(mockDb);
        }
      });
      (service as any).db = mockDb;

      const result = await service.getUndeliveredMessages('user-123');

      expect(result).toHaveLength(1);
      expect(result[0].msgId).toBe('msg-123');
      expect(result[0].targetId).toBe('channel-456');
      expect(result[0].senderId).toBe('user-789');
    });

    it('should filter messages after lastReadMessageId', async () => {
      let callCount = 0;
      const mockDb: any = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: (resolve: any) => {
          callCount++;
          if (callCount === 1) {
            // First query: read status with last read message
            return resolve([
              {
                channelId: 'channel-456',
                lastReadMessageId: 'last-read-msg',
                unreadCount: 1,
              },
            ]);
          } else if (callCount === 2) {
            // Second query: get last read message seqId
            return resolve([{ seqId: BigInt(50) }]);
          } else {
            // Third query: messages after last read
            return resolve([mockMessage]);
          }
        },
      };
      Object.keys(mockDb).forEach((key) => {
        if (key !== 'then' && typeof mockDb[key] === 'function') {
          mockDb[key].mockReturnValue(mockDb);
        }
      });
      (service as any).db = mockDb;

      const result = await service.getUndeliveredMessages('user-123');

      expect(result).toHaveLength(1);
    });

    it('should respect limit parameter', async () => {
      let callCount = 0;
      const mockDb: any = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: (resolve: any) => {
          callCount++;
          if (callCount === 1) {
            return resolve([
              { channelId: 'ch-1', lastReadMessageId: null, unreadCount: 10 },
              { channelId: 'ch-2', lastReadMessageId: null, unreadCount: 10 },
            ]);
          } else {
            // Return more messages than limit
            return resolve(
              Array(10)
                .fill(null)
                .map((_, i) => ({ ...mockMessage, id: `msg-${i}` })),
            );
          }
        },
      };
      Object.keys(mockDb).forEach((key) => {
        if (key !== 'then' && typeof mockDb[key] === 'function') {
          mockDb[key].mockReturnValue(mockDb);
        }
      });
      (service as any).db = mockDb;

      const result = await service.getUndeliveredMessages('user-123', 5);

      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('should convert message to correct envelope format', async () => {
      let callCount = 0;
      const mockDb: any = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: (resolve: any) => {
          callCount++;
          if (callCount === 1) {
            return resolve([
              {
                channelId: 'channel-456',
                lastReadMessageId: null,
                unreadCount: 1,
              },
            ]);
          } else {
            return resolve([mockMessage]);
          }
        },
      };
      Object.keys(mockDb).forEach((key) => {
        if (key !== 'then' && typeof mockDb[key] === 'function') {
          mockDb[key].mockReturnValue(mockDb);
        }
      });
      (service as any).db = mockDb;

      const result = await service.getUndeliveredMessages('user-123');

      expect(result[0]).toMatchObject({
        msgId: 'msg-123',
        type: 'text',
        senderId: 'user-789',
        targetType: 'channel',
        targetId: 'channel-456',
        payload: {
          content: 'Hello world',
        },
      });
    });
  });
});
