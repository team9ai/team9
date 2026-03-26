import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChannelsService } from './channels.service.js';
import { DATABASE_CONNECTION } from '@team9/database';
import { RedisService } from '@team9/redis';
import { ChannelMemberCacheService } from '../shared/channel-member-cache.service.js';

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
            getOrSet: jest.fn<any>().mockResolvedValue(null),
            invalidate: jest.fn<any>().mockResolvedValue(undefined),
          },
        },
        {
          provide: ChannelMemberCacheService,
          useValue: { invalidate: jest.fn<any>().mockResolvedValue(undefined) },
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

  // ── deactivateChannel ──────────────────────────────────────────────

  describe('deactivateChannel', () => {
    let redisService: { getOrSet: MockFn; invalidate: MockFn };

    const now = new Date('2026-03-20T12:00:00Z');

    function makeChannel(overrides: Record<string, unknown> = {}) {
      return {
        id: 'tracking-ch',
        tenantId: 'tenant-1',
        name: 'tracking',
        description: null,
        type: 'tracking',
        avatarUrl: null,
        createdBy: 'user-1',
        sectionId: null,
        order: 0,
        isArchived: false,
        isActivated: true,
        snapshot: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
      };
    }

    beforeEach(() => {
      redisService = (service as any).redis;
      // findById goes through getOrSet — return the channel
      redisService.getOrSet = jest.fn<any>().mockResolvedValue(makeChannel());
    });

    /**
     * Helper: set up mocks for the two parallel queries in deactivateChannel.
     * Query 1: select→from→where→orderBy→limit  (messages)
     * Query 2: select→from→where                 (count)
     * Chain building is synchronous, so where() is called twice in order.
     */
    function mockDeactivateQueries(
      msgs: Array<Record<string, unknown>>,
      count: number,
    ) {
      // 1st where call (messages query) → return chain to continue to orderBy
      db.where.mockReturnValueOnce(db);
      // 1st limit call (messages query) → resolve with msgs
      db.limit.mockResolvedValueOnce(msgs);
      // 2nd where call (count query) → resolve with count result
      db.where.mockResolvedValueOnce([{ count }]);
    }

    it('should deactivate an active tracking channel and return snapshot', async () => {
      const msgs = [
        { id: 'm3', content: 'msg3', metadata: null, createdAt: now },
        { id: 'm2', content: 'msg2', metadata: null, createdAt: now },
        { id: 'm1', content: 'msg1', metadata: null, createdAt: now },
      ];

      mockDeactivateQueries(msgs, 10);

      const result = await service.deactivateChannel('tracking-ch');

      // Messages should be reversed (newest-last)
      expect(result.snapshot.latestMessages).toHaveLength(3);
      expect(result.snapshot.latestMessages[0].id).toBe('m1');
      expect(result.snapshot.latestMessages[2].id).toBe('m3');
      expect(result.snapshot.totalMessageCount).toBe(10);
      // Should update DB with isActivated = false
      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ isActivated: false }),
      );
      // Should invalidate cache
      expect(redisService.invalidate).toHaveBeenCalled();
    });

    it('should also work for task type channels', async () => {
      redisService.getOrSet = jest
        .fn<any>()
        .mockResolvedValue(makeChannel({ type: 'task' }));
      mockDeactivateQueries([], 0);

      const result = await service.deactivateChannel('tracking-ch');

      expect(result.snapshot.totalMessageCount).toBe(0);
      expect(result.snapshot.latestMessages).toEqual([]);
    });

    it('should return existing snapshot when already deactivated', async () => {
      const existingSnapshot = {
        totalMessageCount: 5,
        latestMessages: [
          { id: 'm1', content: 'old', metadata: null, createdAt: now },
        ],
      };
      redisService.getOrSet = jest
        .fn<any>()
        .mockResolvedValue(
          makeChannel({ isActivated: false, snapshot: existingSnapshot }),
        );

      const result = await service.deactivateChannel('tracking-ch');

      expect(result.snapshot).toEqual(existingSnapshot);
      // Should NOT update DB
      expect(db.update).not.toHaveBeenCalled();
    });

    it('should return default snapshot when already deactivated with null snapshot', async () => {
      redisService.getOrSet = jest
        .fn<any>()
        .mockResolvedValue(makeChannel({ isActivated: false, snapshot: null }));

      const result = await service.deactivateChannel('tracking-ch');

      expect(result.snapshot).toEqual({
        totalMessageCount: 0,
        latestMessages: [],
      });
    });

    it('should throw ForbiddenException for non-tracking/task channels', async () => {
      for (const type of ['public', 'private', 'direct']) {
        redisService.getOrSet = jest
          .fn<any>()
          .mockResolvedValue(makeChannel({ type }));

        await expect(service.deactivateChannel('tracking-ch')).rejects.toThrow(
          ForbiddenException,
        );
      }
    });

    it('should throw NotFoundException when channel not found', async () => {
      redisService.getOrSet = jest.fn<any>().mockResolvedValue(null);

      await expect(service.deactivateChannel('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should preserve metadata in snapshot latestMessages', async () => {
      const meta = { agentEventType: 'thinking', status: 'completed' };
      mockDeactivateQueries(
        [{ id: 'm1', content: 'thinking...', metadata: meta, createdAt: now }],
        1,
      );

      const result = await service.deactivateChannel('tracking-ch');

      expect(result.snapshot.latestMessages[0].metadata).toEqual(meta);
    });
  });

  // ── isUserInTenant ────────────────────────────────────────────────

  describe('isUserInTenant', () => {
    it('should return true when user is a tenant member', async () => {
      db.limit.mockResolvedValueOnce([{ id: 'member-1' }]);

      const result = await service.isUserInTenant('user-1', 'tenant-1');

      expect(result).toBe(true);
    });

    it('should return false when user is not a tenant member', async () => {
      db.limit.mockResolvedValueOnce([]);

      const result = await service.isUserInTenant('user-1', 'tenant-1');

      expect(result).toBe(false);
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
