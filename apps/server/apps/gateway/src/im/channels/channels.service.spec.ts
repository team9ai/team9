import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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

  describe('createDirectChannel', () => {
    it('returns an existing direct channel without inserting or re-adding members', async () => {
      const existingChannel = {
        id: 'dm-existing',
        tenantId: 'tenant-1',
        type: 'direct',
        createdBy: 'user-1',
      };
      const addMemberSpy = jest.spyOn(service, 'addMember');

      // First limit call: assertDirectMessageAllowed bot lookup → not a bot
      db.limit.mockResolvedValueOnce([] as any);
      db.having.mockResolvedValueOnce([{ channelId: 'dm-existing' }] as any);
      db.limit.mockResolvedValueOnce([existingChannel] as any);

      await expect(
        service.createDirectChannel('user-1', 'user-2', 'tenant-1'),
      ).resolves.toEqual(existingChannel);

      expect(db.insert).not.toHaveBeenCalled();
      expect(addMemberSpy).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when target is a restricted personal staff bot', async () => {
      // Bot lookup returns a personal staff bot owned by someone else
      db.limit.mockResolvedValueOnce([
        {
          ownerId: 'other-owner',
          extra: {
            personalStaff: {
              visibility: { allowMention: false, allowDirectMessage: false },
            },
          },
          applicationId: 'personal-staff',
        },
      ] as any);

      await expect(
        service.createDirectChannel('user-1', 'bot-user', 'tenant-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows DM when target personal staff bot has allowDirectMessage=true', async () => {
      const addMemberSpy = jest
        .spyOn(service, 'addMember')
        .mockResolvedValue(undefined);

      // Bot lookup returns a personal staff bot with allowDirectMessage=true
      db.limit.mockResolvedValueOnce([
        {
          ownerId: 'other-owner',
          extra: {
            personalStaff: {
              visibility: { allowMention: false, allowDirectMessage: true },
            },
          },
          applicationId: 'personal-staff',
        },
      ] as any);
      // No existing channel
      db.having.mockResolvedValueOnce([] as any);
      // New channel creation
      db.returning.mockResolvedValueOnce([
        {
          id: 'new-dm',
          tenantId: 'tenant-1',
          type: 'direct',
          createdBy: 'user-1',
        },
      ] as any);

      await expect(
        service.createDirectChannel('user-1', 'bot-user', 'tenant-1'),
      ).resolves.toBeDefined();

      addMemberSpy.mockRestore();
    });

    it('allows DM when requester is the owner of the personal staff bot', async () => {
      const addMemberSpy = jest
        .spyOn(service, 'addMember')
        .mockResolvedValue(undefined);

      // Bot lookup returns a personal staff bot owned by the requester
      db.limit.mockResolvedValueOnce([
        {
          ownerId: 'user-1',
          extra: {
            personalStaff: {
              visibility: { allowMention: false, allowDirectMessage: false },
            },
          },
          applicationId: 'personal-staff',
        },
      ] as any);
      // No existing channel
      db.having.mockResolvedValueOnce([] as any);
      // New channel creation
      db.returning.mockResolvedValueOnce([
        {
          id: 'new-dm',
          tenantId: 'tenant-1',
          type: 'direct',
          createdBy: 'user-1',
        },
      ] as any);

      await expect(
        service.createDirectChannel('user-1', 'bot-user', 'tenant-1'),
      ).resolves.toBeDefined();

      addMemberSpy.mockRestore();
    });
  });

  describe('assertMentionsAllowed', () => {
    it('does nothing when no user IDs are provided', async () => {
      await expect(
        service.assertMentionsAllowed('sender-1', []),
      ).resolves.toBeUndefined();
    });

    it('does nothing when mentioned users are not bots', async () => {
      // Bot query returns empty (no matching bots)
      db.where.mockResolvedValueOnce([] as any);

      await expect(
        service.assertMentionsAllowed('sender-1', ['user-a', 'user-b']),
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenException when mentioning a restricted personal staff bot', async () => {
      db.where.mockResolvedValueOnce([
        {
          userId: 'bot-user',
          ownerId: 'other-owner',
          extra: {
            personalStaff: {
              visibility: { allowMention: false, allowDirectMessage: false },
            },
          },
          applicationId: 'personal-staff',
        },
      ] as any);

      await expect(
        service.assertMentionsAllowed('sender-1', ['bot-user']),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows mention when sender is the owner', async () => {
      db.where.mockResolvedValueOnce([
        {
          userId: 'bot-user',
          ownerId: 'sender-1',
          extra: {
            personalStaff: {
              visibility: { allowMention: false, allowDirectMessage: false },
            },
          },
          applicationId: 'personal-staff',
        },
      ] as any);

      await expect(
        service.assertMentionsAllowed('sender-1', ['bot-user']),
      ).resolves.toBeUndefined();
    });

    it('allows mention when allowMention is true', async () => {
      db.where.mockResolvedValueOnce([
        {
          userId: 'bot-user',
          ownerId: 'other-owner',
          extra: {
            personalStaff: {
              visibility: { allowMention: true, allowDirectMessage: false },
            },
          },
          applicationId: 'personal-staff',
        },
      ] as any);

      await expect(
        service.assertMentionsAllowed('sender-1', ['bot-user']),
      ).resolves.toBeUndefined();
    });

    it('skips non-personal-staff bots', async () => {
      db.where.mockResolvedValueOnce([
        {
          userId: 'common-bot',
          ownerId: 'other-owner',
          extra: { commonStaff: {} },
          applicationId: 'common-staff',
        },
      ] as any);

      await expect(
        service.assertMentionsAllowed('sender-1', ['common-bot']),
      ).resolves.toBeUndefined();
    });
  });

  describe('create', () => {
    it('creates a channel and adds the creator as owner', async () => {
      const createdChannel = {
        id: 'channel-1',
        tenantId: 'tenant-1',
        name: 'general',
        description: 'team chat',
        type: 'public',
      };
      const addMemberSpy = jest
        .spyOn(service, 'addMember')
        .mockResolvedValue(undefined);

      db.returning.mockResolvedValueOnce([createdChannel] as any);

      await expect(
        service.create(
          {
            name: 'general',
            description: 'team chat',
            type: 'public',
            avatarUrl: null,
          } as any,
          'user-1',
          'tenant-1',
        ),
      ).resolves.toEqual(createdChannel);

      expect(db.insert).toHaveBeenCalled();
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          name: 'general',
          description: 'team chat',
          type: 'public',
          createdBy: 'user-1',
        }),
      );
      expect(addMemberSpy).toHaveBeenCalledWith('channel-1', 'user-1', 'owner');
    });
  });

  describe('createDirectChannelsBatch', () => {
    it('returns an empty map when no member IDs are provided', async () => {
      const result = await service.createDirectChannelsBatch(
        'new-user',
        [],
        'tenant-1',
      );

      expect(result).toEqual(new Map());
      expect(db.select).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('creates missing DM channels and merges them with existing ones', async () => {
      const existingChannel = {
        id: 'dm-existing',
        tenantId: 'tenant-1',
        type: 'direct',
        createdBy: 'member-1',
      };
      const insertedChannels = [
        {
          id: 'dm-new-2',
          tenantId: 'tenant-1',
          type: 'direct',
          createdBy: 'member-2',
        },
        {
          id: 'dm-new-3',
          tenantId: 'tenant-1',
          type: 'direct',
          createdBy: 'member-3',
        },
      ];

      db.where
        .mockResolvedValueOnce([
          { channelId: 'dm-existing', userId: 'member-1' },
        ] as any)
        .mockResolvedValueOnce([existingChannel] as any);
      db.returning.mockResolvedValueOnce(insertedChannels as any);

      const result = await service.createDirectChannelsBatch(
        'new-user',
        ['member-1', 'member-2', 'member-3'],
        'tenant-1',
      );

      expect(result.get('member-1')).toEqual(existingChannel);
      expect(result.get('member-2')).toEqual(insertedChannels[0]);
      expect(result.get('member-3')).toEqual(insertedChannels[1]);

      expect(db.insert).toHaveBeenCalledTimes(2);
      expect(db.values).toHaveBeenNthCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({ createdBy: 'member-2', type: 'direct' }),
          expect.objectContaining({ createdBy: 'member-3', type: 'direct' }),
        ]),
      );

      const insertedMemberRows = db.values.mock.calls[1][0] as Array<
        Record<string, unknown>
      >;
      expect(insertedMemberRows).toHaveLength(4);
      expect(insertedMemberRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            channelId: 'dm-new-2',
            userId: 'member-2',
            role: 'member',
          }),
          expect.objectContaining({
            channelId: 'dm-new-2',
            userId: 'new-user',
            role: 'member',
          }),
          expect.objectContaining({
            channelId: 'dm-new-3',
            userId: 'member-3',
            role: 'member',
          }),
          expect.objectContaining({
            channelId: 'dm-new-3',
            userId: 'new-user',
            role: 'member',
          }),
        ]),
      );
      expect(insertedMemberRows).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userId: 'member-1' }),
        ]),
      );
    });
  });

  describe('findById', () => {
    it('returns a channel through the redis-backed lookup', async () => {
      const redisService = (service as any).redis;
      const channel = {
        id: 'channel-1',
        tenantId: 'tenant-1',
        name: 'general',
        description: null,
        type: 'public',
        avatarUrl: null,
        createdBy: 'user-1',
        sectionId: null,
        order: 0,
        isArchived: false,
        isActivated: true,
        snapshot: null,
        createdAt: new Date('2026-03-22T00:00:00Z'),
        updatedAt: new Date('2026-03-22T00:00:00Z'),
      };

      redisService.getOrSet = jest.fn<any>(async (_key, loader, ttl) => {
        expect(ttl).toBe(120);
        return loader();
      });
      db.limit.mockResolvedValueOnce([channel] as any);

      await expect(service.findById('channel-1')).resolves.toEqual(channel);
      expect(redisService.getOrSet).toHaveBeenCalledTimes(1);
    });

    it('returns null when the channel does not exist', async () => {
      const redisService = (service as any).redis;
      redisService.getOrSet = jest.fn<any>(async (_key, loader) => loader());
      db.limit.mockResolvedValueOnce([] as any);

      await expect(service.findById('missing-channel')).resolves.toBeNull();
    });
  });

  describe('findByNameAndTenant', () => {
    it('returns the first matching channel for the given tenant', async () => {
      const channel = {
        id: 'channel-1',
        tenantId: 'tenant-1',
        name: 'general',
        description: 'team chat',
        type: 'public',
        avatarUrl: null,
        createdBy: 'user-1',
        sectionId: null,
        order: 0,
        isArchived: false,
        isActivated: true,
        snapshot: null,
        createdAt: new Date('2026-03-22T00:00:00Z'),
        updatedAt: new Date('2026-03-22T00:00:00Z'),
      };

      db.limit.mockResolvedValueOnce([channel] as any);

      await expect(
        service.findByNameAndTenant('general', 'tenant-1'),
      ).resolves.toEqual(channel);
    });
  });

  describe('getChannelMemberIds', () => {
    it('returns active member user ids', async () => {
      db.where.mockResolvedValueOnce([
        { userId: 'user-1' },
        { userId: 'user-2' },
      ] as any);

      await expect(service.getChannelMemberIds('channel-1')).resolves.toEqual([
        'user-1',
        'user-2',
      ]);
    });
  });

  describe('getPublicChannels', () => {
    it('returns public channels with membership metadata', async () => {
      const rows = [
        {
          id: 'channel-1',
          tenantId: 'tenant-1',
          name: 'general',
          description: null,
          type: 'public',
          avatarUrl: null,
          createdBy: 'user-1',
          sectionId: null,
          order: 0,
          isArchived: false,
          isActivated: true,
          snapshot: null,
          createdAt: new Date('2026-03-23T00:00:00Z'),
          updatedAt: new Date('2026-03-23T00:00:00Z'),
          memberCount: 3,
          isMember: true,
        },
      ];

      db.where.mockResolvedValueOnce(rows as any);

      await expect(
        service.getPublicChannels('tenant-1', 'user-1'),
      ).resolves.toEqual(rows);
    });
  });

  describe('isBot', () => {
    it('returns true for bot users and false for human users', async () => {
      db.limit.mockResolvedValueOnce([{ userType: 'bot' }] as any);
      await expect(service.isBot('bot-user')).resolves.toBe(true);

      db.limit.mockResolvedValueOnce([{ userType: 'human' }] as any);
      await expect(service.isBot('human-user')).resolves.toBe(false);
    });
  });

  describe('update', () => {
    it('updates a channel for authorized users and invalidates the cache', async () => {
      const redisService = (service as any).redis;
      const updatedChannel = {
        id: 'channel-1',
        tenantId: 'tenant-1',
        name: 'renamed',
        description: 'updated',
        type: 'public',
        avatarUrl: null,
        createdBy: 'user-1',
        sectionId: null,
        order: 0,
        isArchived: false,
        isActivated: true,
        snapshot: null,
        createdAt: new Date('2026-03-24T00:00:00Z'),
        updatedAt: new Date('2026-03-24T00:00:00Z'),
      };

      jest.spyOn(service, 'getMemberRole').mockResolvedValue('admin');
      db.returning.mockResolvedValueOnce([updatedChannel] as any);

      await expect(
        service.update(
          'channel-1',
          { name: 'renamed', description: 'updated' } as any,
          'user-1',
        ),
      ).resolves.toEqual(updatedChannel);

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'renamed',
          description: 'updated',
          updatedAt: expect.any(Date),
        }),
      );
      expect(redisService.invalidate).toHaveBeenCalled();
    });

    it('rejects updates from non-admin members', async () => {
      jest.spyOn(service, 'getMemberRole').mockResolvedValue('member');

      await expect(
        service.update('channel-1', { name: 'renamed' } as any, 'user-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(db.update).not.toHaveBeenCalled();
    });

    it('throws when the channel no longer exists', async () => {
      jest.spyOn(service, 'getMemberRole').mockResolvedValue('owner');
      db.returning.mockResolvedValueOnce([] as any);

      await expect(
        service.update('channel-1', { name: 'renamed' } as any, 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
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

  // ── assertReadAccess ─────────────────────────────────────────────

  describe('assertReadAccess', () => {
    let redisService: { getOrSet: MockFn };

    beforeEach(() => {
      redisService = (service as any).redis;
    });

    it('should pass when user is a channel member', async () => {
      // getMemberRole → returns 'member'
      redisService.getOrSet = jest.fn<any>().mockResolvedValueOnce('member');

      await expect(
        service.assertReadAccess('ch-1', 'user-1'),
      ).resolves.toBeUndefined();
    });

    it('should pass for public channel when user is not a member', async () => {
      // getMemberRole → null (not a member)
      redisService.getOrSet = jest
        .fn<any>()
        .mockResolvedValueOnce(null)
        // findById → public channel
        .mockResolvedValueOnce({ id: 'ch-1', type: 'public', tenantId: 't-1' });

      await expect(
        service.assertReadAccess('ch-1', 'user-1'),
      ).resolves.toBeUndefined();
    });

    it('should pass for tracking channel when user is a tenant member', async () => {
      // getMemberRole → null
      redisService.getOrSet = jest
        .fn<any>()
        .mockResolvedValueOnce(null)
        // findById → tracking channel
        .mockResolvedValueOnce({
          id: 'ch-1',
          type: 'tracking',
          tenantId: 't-1',
        });
      // isUserInTenant → found
      db.limit.mockResolvedValueOnce([{ id: 'member-1' }]);

      await expect(
        service.assertReadAccess('ch-1', 'user-1'),
      ).resolves.toBeUndefined();
    });

    it('should throw for tracking channel when user is NOT a tenant member', async () => {
      redisService.getOrSet = jest
        .fn<any>()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'ch-1',
          type: 'tracking',
          tenantId: 't-1',
        });
      // isUserInTenant → not found
      db.limit.mockResolvedValueOnce([]);

      await expect(service.assertReadAccess('ch-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw for tracking channel with null tenantId', async () => {
      redisService.getOrSet = jest
        .fn<any>()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'ch-1',
          type: 'tracking',
          tenantId: null,
        });

      await expect(service.assertReadAccess('ch-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw for non-existent channel', async () => {
      redisService.getOrSet = jest
        .fn<any>()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      await expect(
        service.assertReadAccess('nonexistent', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw for private channel when user is not a member', async () => {
      redisService.getOrSet = jest
        .fn<any>()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'ch-1',
          type: 'private',
          tenantId: 't-1',
        });

      await expect(service.assertReadAccess('ch-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('getUserChannels', () => {
    it('attaches other user info for direct channels and keeps public channels unchanged', async () => {
      db.where
        .mockResolvedValueOnce([
          {
            id: 'direct-1',
            tenantId: 'tenant-1',
            name: 'dm',
            description: null,
            type: 'direct',
            avatarUrl: null,
            createdBy: 'user-1',
            sectionId: null,
            order: 0,
            isArchived: false,
            isActivated: true,
            snapshot: null,
            createdAt: new Date('2026-03-21T00:00:00Z'),
            updatedAt: new Date('2026-03-21T00:00:00Z'),
            unreadCount: 2,
            lastReadMessageId: 'msg-1',
          },
          {
            id: 'public-1',
            tenantId: 'tenant-1',
            name: 'general',
            description: null,
            type: 'public',
            avatarUrl: null,
            createdBy: 'user-1',
            sectionId: null,
            order: 0,
            isArchived: false,
            isActivated: true,
            snapshot: null,
            createdAt: new Date('2026-03-21T00:00:00Z'),
            updatedAt: new Date('2026-03-21T00:00:00Z'),
            unreadCount: 0,
            lastReadMessageId: null,
          },
        ] as any)
        .mockResolvedValueOnce([
          {
            channelId: 'direct-1',
            userId: 'user-1',
            username: 'alice',
            displayName: 'Alice',
            avatarUrl: null,
            status: 'online',
            userType: 'human',
          },
          {
            channelId: 'direct-1',
            userId: 'user-2',
            username: 'bob',
            displayName: 'Bob',
            avatarUrl: null,
            status: 'away',
            userType: 'bot',
            applicationId: 'openclaw',
            managedProvider: null,
            managedMeta: null,
            agentType: 'openclaw',
          },
        ] as any);

      const result = await service.getUserChannels('user-1', 'tenant-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'direct-1',
        type: 'direct',
        otherUser: {
          id: 'user-2',
          username: 'bob',
          displayName: 'Bob',
          avatarUrl: null,
          status: 'away',
          userType: 'bot',
          agentType: 'openclaw',
        },
      });
      expect(result[1]).toMatchObject({
        id: 'public-1',
        type: 'public',
      });
      expect(result[1]).not.toHaveProperty('otherUser');
    });
  });

  describe('findByIdOrThrow', () => {
    it('throws when a channel does not exist', async () => {
      jest.spyOn(service, 'findById').mockResolvedValue(null);

      await expect(service.findByIdOrThrow('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('attaches DM other-user metadata for direct channels', async () => {
      jest.spyOn(service, 'findById').mockResolvedValue({
        id: 'dm-1',
        type: 'direct',
        name: null,
      } as any);
      jest.spyOn(service as any, 'getDmOtherUser').mockResolvedValue({
        id: 'user-2',
        username: 'alice',
      });

      await expect(service.findByIdOrThrow('dm-1', 'user-1')).resolves.toEqual(
        expect.objectContaining({
          id: 'dm-1',
          unreadCount: 0,
          lastReadMessageId: null,
          otherUser: { id: 'user-2', username: 'alice' },
        }),
      );
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

  describe('addMember', () => {
    it('rejoins a previously left member and invalidates caches', async () => {
      const redisService = (service as any).redis;
      const memberCacheService = (service as any).channelMemberCacheService;

      db.limit.mockResolvedValueOnce([
        {
          id: 'member-record-1',
          leftAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      ] as any);

      await expect(
        service.addMember('channel-1', 'user-1', 'admin'),
      ).resolves.toBeUndefined();

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          leftAt: null,
          joinedAt: expect.any(Date),
          role: 'admin',
        }),
      );
      expect(db.insert).not.toHaveBeenCalled();
      expect(memberCacheService.invalidate).toHaveBeenCalledWith('channel-1');
      expect(redisService.invalidate).toHaveBeenCalled();
    });

    it('rejects when the user is already an active member', async () => {
      const redisService = (service as any).redis;
      const memberCacheService = (service as any).channelMemberCacheService;

      db.limit.mockResolvedValueOnce([
        {
          id: 'member-record-1',
          leftAt: null,
        },
      ] as any);

      await expect(
        service.addMember('channel-1', 'user-1'),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(db.update).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
      expect(memberCacheService.invalidate).not.toHaveBeenCalled();
      expect(redisService.invalidate).not.toHaveBeenCalled();
    });

    it('inserts a new member when no record exists yet', async () => {
      const redisService = (service as any).redis;
      const memberCacheService = (service as any).channelMemberCacheService;

      db.limit.mockResolvedValueOnce([] as any);

      await expect(
        service.addMember('channel-1', 'user-1', 'member'),
      ).resolves.toBeUndefined();

      expect(db.insert).toHaveBeenCalled();
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'channel-1',
          userId: 'user-1',
          role: 'member',
        }),
      );
      expect(memberCacheService.invalidate).toHaveBeenCalledWith('channel-1');
      expect(redisService.invalidate).toHaveBeenCalled();
    });
  });

  describe('removeMember', () => {
    it('allows self-removal even when the requester has no elevated role', async () => {
      const redisService = (service as any).redis;
      const memberCacheService = (service as any).channelMemberCacheService;

      jest.spyOn(service, 'getMemberRole').mockResolvedValue(null);

      await expect(
        service.removeMember('channel-1', 'user-1', 'user-1'),
      ).resolves.toBeUndefined();

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith({ leftAt: expect.any(Date) });
      expect(memberCacheService.invalidate).toHaveBeenCalledWith('channel-1');
      expect(redisService.invalidate).toHaveBeenCalled();
    });

    it('rejects removing another user without elevated permissions', async () => {
      jest.spyOn(service, 'getMemberRole').mockResolvedValue(null);

      await expect(
        service.removeMember('channel-1', 'user-2', 'user-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('updateMember', () => {
    it('allows an owner to change a member role and invalidates role cache', async () => {
      const redisService = (service as any).redis;

      jest.spyOn(service, 'getMemberRole').mockResolvedValue('owner');

      await expect(
        service.updateMember(
          'channel-1',
          'user-2',
          { role: 'admin' } as any,
          'owner-1',
        ),
      ).resolves.toBeUndefined();

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith({ role: 'admin' });
      expect(redisService.invalidate).toHaveBeenCalled();
    });

    it('rejects role changes from non-owners', async () => {
      jest.spyOn(service, 'getMemberRole').mockResolvedValue('admin');

      await expect(
        service.updateMember(
          'channel-1',
          'user-2',
          { role: 'member' } as any,
          'admin-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('archiveChannel', () => {
    it('archives a non-direct channel for admins and invalidates cache', async () => {
      const redisService = (service as any).redis;
      const updatedChannel = {
        id: 'channel-1',
        type: 'private',
        isArchived: true,
      };

      jest.spyOn(service, 'getMemberRole').mockResolvedValue('admin');
      jest.spyOn(service, 'findById').mockResolvedValue({
        id: 'channel-1',
        type: 'private',
        tenantId: 'tenant-1',
      } as any);
      db.returning.mockResolvedValueOnce([updatedChannel] as any);

      await expect(
        service.archiveChannel('channel-1', 'admin-1'),
      ).resolves.toEqual(updatedChannel);

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          isArchived: true,
          updatedAt: expect.any(Date),
        }),
      );
      expect(redisService.invalidate).toHaveBeenCalled();
    });

    it('rejects archiving direct channels', async () => {
      jest.spyOn(service, 'getMemberRole').mockResolvedValue('owner');
      jest.spyOn(service, 'findById').mockResolvedValue({
        id: 'channel-1',
        type: 'direct',
        tenantId: 'tenant-1',
      } as any);

      await expect(
        service.archiveChannel('channel-1', 'owner-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('unarchiveChannel', () => {
    it('restores an archived channel for admins and invalidates cache', async () => {
      const redisService = (service as any).redis;
      const updatedChannel = {
        id: 'channel-1',
        type: 'private',
        isArchived: false,
      };

      jest.spyOn(service, 'getMemberRole').mockResolvedValue('admin');
      db.returning.mockResolvedValueOnce([updatedChannel] as any);

      await expect(
        service.unarchiveChannel('channel-1', 'admin-1'),
      ).resolves.toEqual(updatedChannel);

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          isArchived: false,
          updatedAt: expect.any(Date),
        }),
      );
      expect(redisService.invalidate).toHaveBeenCalled();
    });
  });

  describe('getPublicChannelPreview', () => {
    it('returns null when the public channel does not exist', async () => {
      db.limit.mockResolvedValueOnce([] as any);

      await expect(
        service.getPublicChannelPreview('channel-1', 'user-1'),
      ).resolves.toBeNull();
    });

    it('returns member status and member count for public channels', async () => {
      jest.spyOn(service, 'isMember').mockResolvedValueOnce(true);
      db.limit.mockResolvedValueOnce([
        {
          id: 'channel-1',
          type: 'public',
          name: 'general',
        },
      ] as any);
      db.then = jest.fn<any>(
        (handler: (rows: Array<{ count: number }>) => unknown) =>
          Promise.resolve(handler([{ count: 3 }])),
      );

      await expect(
        service.getPublicChannelPreview('channel-1', 'user-1'),
      ).resolves.toEqual(
        expect.objectContaining({
          id: 'channel-1',
          isMember: true,
          memberCount: 3,
        }),
      );
    });
  });

  describe('joinPublicChannel', () => {
    it('rejects missing or non-public channels and adds membership for public ones', async () => {
      const addMemberSpy = jest
        .spyOn(service, 'addMember')
        .mockResolvedValue(undefined);

      jest.spyOn(service, 'findById').mockResolvedValueOnce(null);
      await expect(
        service.joinPublicChannel('missing', 'user-1'),
      ).rejects.toThrow(NotFoundException);

      jest.spyOn(service, 'findById').mockResolvedValueOnce({
        id: 'channel-2',
        type: 'private',
      } as any);
      await expect(
        service.joinPublicChannel('channel-2', 'user-1'),
      ).rejects.toThrow(ForbiddenException);

      jest.spyOn(service, 'findById').mockResolvedValueOnce({
        id: 'channel-3',
        type: 'public',
      } as any);
      await expect(
        service.joinPublicChannel('channel-3', 'user-1'),
      ).resolves.toBeUndefined();

      expect(addMemberSpy).toHaveBeenCalledWith(
        'channel-3',
        'user-1',
        'member',
      );
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

  describe('activateChannel', () => {
    it('reactivates an inactive tracking channel and invalidates cache', async () => {
      const redisService = (service as any).redis;

      jest.spyOn(service, 'findById').mockResolvedValue({
        id: 'tracking-ch',
        type: 'tracking',
        isActivated: false,
        tenantId: 'tenant-1',
      } as any);

      await expect(
        service.activateChannel('tracking-ch'),
      ).resolves.toBeUndefined();

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith({
        isActivated: true,
        updatedAt: expect.any(Date),
      });
      expect(redisService.invalidate).toHaveBeenCalled();
    });
  });

  describe('deleteChannel', () => {
    it('rejects deletion when the confirmation name does not match', async () => {
      const redisService = (service as any).redis;

      jest.spyOn(service, 'getMemberRole').mockResolvedValue('owner');
      jest.spyOn(service, 'findById').mockResolvedValue({
        id: 'channel-1',
        name: 'expected-name',
        type: 'private',
        tenantId: 'tenant-1',
      } as any);

      await expect(
        service.deleteChannel('channel-1', 'owner-1', 'wrong-name'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(db.delete).not.toHaveBeenCalled();
      expect(redisService.invalidate).not.toHaveBeenCalled();
    });

    it('deletes a private channel for the owner and invalidates cache', async () => {
      const redisService = (service as any).redis;

      jest.spyOn(service, 'getMemberRole').mockResolvedValue('owner');
      jest.spyOn(service, 'findById').mockResolvedValue({
        id: 'channel-1',
        name: 'expected-name',
        type: 'private',
        tenantId: 'tenant-1',
      } as any);
      db.where.mockResolvedValueOnce(undefined as any);

      await expect(
        service.deleteChannel('channel-1', 'owner-1'),
      ).resolves.toBeUndefined();

      expect(db.delete).toHaveBeenCalled();
      expect(redisService.invalidate).toHaveBeenCalled();
    });
  });

  describe('channel name helpers', () => {
    it('normalizes names and validates unicode-friendly channel names', () => {
      expect(ChannelsService.normalizeChannelName('  Team   Updates  ')).toBe(
        'Team-Updates',
      );
      expect(ChannelsService.validateChannelName('产品_roadmap-1')).toEqual({
        valid: true,
      });
      expect(ChannelsService.validateChannelName('')).toEqual({
        valid: false,
        error: 'Channel name is required',
      });
      expect(ChannelsService.validateChannelName('-bad')).toEqual({
        valid: false,
        error: 'Channel name must start with a letter or number',
      });
    });
  });
});
