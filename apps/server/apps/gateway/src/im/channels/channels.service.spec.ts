import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ChannelsService } from './channels.service.js';
import { RedisService } from '@team9/redis';
import { DATABASE_CONNECTION } from '@team9/database';

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
    'delete',
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.limit.mockResolvedValue([]);
  chain.returning.mockResolvedValue([]);
  return chain;
}

describe('ChannelsService', () => {
  let service: ChannelsService;
  let db: ReturnType<typeof mockDb>;

  beforeEach(async () => {
    db = mockDb();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelsService,
        { provide: DATABASE_CONNECTION, useValue: db },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn<any>().mockResolvedValue(null),
            set: jest.fn<any>().mockResolvedValue(undefined),
            del: jest.fn<any>().mockResolvedValue(undefined),
            hget: jest.fn<any>().mockResolvedValue(null),
            hset: jest.fn<any>().mockResolvedValue(undefined),
            hdel: jest.fn<any>().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<ChannelsService>(ChannelsService);
  });

  // ── sendSystemMessage ───────────────────────────────────────────────

  describe('sendSystemMessage', () => {
    const now = new Date('2026-01-15T10:00:00Z');

    const MESSAGE_ROW = {
      id: 'msg-uuid',
      channelId: 'channel-uuid',
      senderId: null,
      content: 'Alice joined Test Workspace',
      type: 'system',
      isPinned: false,
      isEdited: false,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    };

    beforeEach(() => {
      db.returning.mockResolvedValue([MESSAGE_ROW] as any);
    });

    it('should insert a message with type system and senderId null', async () => {
      await service.sendSystemMessage(
        'channel-uuid',
        'Alice joined Test Workspace',
      );

      expect(db.insert).toHaveBeenCalled();
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'channel-uuid',
          content: 'Alice joined Test Workspace',
          type: 'system',
          senderId: null,
        }),
      );
    });

    it('should return full message data with all fields', async () => {
      const result = await service.sendSystemMessage(
        'channel-uuid',
        'Alice joined Test Workspace',
      );

      expect(result).toEqual({
        id: 'msg-uuid',
        channelId: 'channel-uuid',
        senderId: null,
        content: 'Alice joined Test Workspace',
        type: 'system',
        isPinned: false,
        isEdited: false,
        isDeleted: false,
        createdAt: now,
        updatedAt: now,
      });
    });

    it('should use provided content when message.content is null', async () => {
      db.returning.mockResolvedValue([
        { ...MESSAGE_ROW, content: null },
      ] as any);

      const result = await service.sendSystemMessage(
        'channel-uuid',
        'fallback content',
      );

      expect(result.content).toBe('fallback content');
    });
  });

  // ── deleteDirectChannelsForUser ────────────────────────────────────

  describe('deleteDirectChannelsForUser', () => {
    let redisService: { invalidate: MockFn };

    beforeEach(() => {
      redisService = (service as any).redis;
      redisService.invalidate = jest.fn<any>().mockResolvedValue(undefined);
    });

    it('should delete DM channels and invalidate Redis cache', async () => {
      // First where() call: select query returns DM channel IDs
      db.where.mockResolvedValueOnce([
        { channelId: 'dm-1' },
        { channelId: 'dm-2' },
      ]);
      // Second where() call: delete query resolves
      db.where.mockResolvedValueOnce(undefined);

      const count = await service.deleteDirectChannelsForUser('bot-user-id');

      expect(count).toBe(2);
      expect(db.delete).toHaveBeenCalled();
      expect(redisService.invalidate).toHaveBeenCalledTimes(2);
    });

    it('should return 0 and skip delete when no DM channels exist', async () => {
      db.where.mockResolvedValueOnce([]);

      const count = await service.deleteDirectChannelsForUser('bot-user-id');

      expect(count).toBe(0);
      // delete should not be called since there are no channels
    });
  });
});
