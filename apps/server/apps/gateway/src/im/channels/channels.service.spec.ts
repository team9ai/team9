import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ChannelsService,
  defaultDmOutboundPolicy,
  isTargetAllowed,
} from './channels.service.js';
import { DATABASE_CONNECTION } from '@team9/database';
import type { BotExtra, DmOutboundPolicy } from '@team9/database/schemas';
import { RedisService } from '@team9/redis';
import { ChannelMemberCacheService } from '../shared/channel-member-cache.service.js';
import { TabsService } from '../views/tabs.service.js';
import { BOT_SERVICE_TOKEN } from './channels.service.js';

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
    'onConflictDoNothing',
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.limit.mockResolvedValue([]);
  chain.returning.mockResolvedValue([]);
  chain.onConflictDoNothing.mockResolvedValue(undefined);
  // Default: pass the same mock as the "tx" argument, so the same chain
  // assertions work whether a call runs inside or outside a transaction.
  // Tests that need to verify tx-vs-db distinction can override this via
  // `db.transaction.mockImplementationOnce(async (cb) => cb(customTx))`.
  chain.transaction = jest
    .fn<any>()
    .mockImplementation(async (cb: any) => cb(chain));
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
        {
          provide: TabsService,
          useValue: {
            seedBuiltinTabs: jest.fn<any>().mockResolvedValue(undefined),
          },
        },
        {
          provide: BOT_SERVICE_TOKEN,
          useValue: {
            getBotMentorId: jest.fn<any>().mockResolvedValue(null),
            findActiveBotsByMentorId: jest.fn<any>().mockResolvedValue([]),
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

  describe('createDirectChannel - echo (self-chat)', () => {
    // Invariants under test (regression for "Failed to create echo channel"):
    //
    // 1. Atomicity — channel row + owner member row are created in the same
    //    db.transaction, so a mid-flight failure cannot leave an orphaned
    //    channel row behind.
    //
    // 2. Self-healing — the existing-channel lookup queries im_channels
    //    directly by (type='echo', created_by=userId, tenant_id=?), NOT via
    //    an innerJoin against im_channel_members. Previously, if a prior
    //    attempt had leaked an orphaned channel (no member row), the
    //    innerJoin-based lookup would skip it and the next call would keep
    //    creating duplicates. The new lookup reuses the orphan and repairs
    //    its membership.
    //
    // 3. Post-commit side effects — caches are only invalidated after the
    //    transaction has committed, to avoid exposing in-flight state.

    it('wraps fresh echo channel creation in a db.transaction and invalidates caches post-commit', async () => {
      // No existing echo channel in im_channels.
      db.limit.mockResolvedValueOnce([] as any);
      // Inside the transaction, the channel INSERT returns the new row.
      db.returning.mockResolvedValueOnce([
        {
          id: 'echo-new',
          tenantId: 'tenant-1',
          type: 'echo',
          createdBy: 'user-1',
        },
      ] as any);
      const memberCacheService = (service as any).channelMemberCacheService;
      const redisService = (service as any).redis;

      const result = await service.createDirectChannel(
        'user-1',
        'user-1',
        'tenant-1',
      );

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual(
        expect.objectContaining({ id: 'echo-new', type: 'echo' }),
      );
      // Both the channel row and the member row must be inserted.
      expect(db.insert.mock.calls.length).toBeGreaterThanOrEqual(2);
      // Member row payload references the freshly created channel and owner.
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'echo-new',
          userId: 'user-1',
          role: 'owner',
        }),
      );
      // Caches must be invalidated exactly once, after the transaction.
      expect(memberCacheService.invalidate).toHaveBeenCalledTimes(1);
      expect(memberCacheService.invalidate).toHaveBeenCalledWith('echo-new');
      expect(redisService.invalidate).toHaveBeenCalledTimes(1);
      // Ordering — the transaction must complete before cache invalidation.
      expect(db.transaction.mock.invocationCallOrder[0]).toBeLessThan(
        memberCacheService.invalidate.mock.invocationCallOrder[0],
      );
    });

    it('runs both inserts via the tx callback argument, not via this.db', async () => {
      // Regression guard for "the mock passes `chain` as tx" weakness: a
      // future refactor that accidentally calls this.db.insert inside the
      // transaction body must fail this test, not silently pass.
      db.limit.mockResolvedValueOnce([] as any); // no existing echo.

      const txReturning = jest
        .fn<any>()
        .mockResolvedValue([
          { id: 'echo-tx', tenantId: 't-1', type: 'echo', createdBy: 'u-1' },
        ]);
      const txValues = jest
        .fn<any>()
        .mockReturnValue({ returning: txReturning });
      const txInsert = jest.fn<any>().mockReturnValue({ values: txValues });
      db.transaction.mockImplementationOnce(async (cb: any) =>
        cb({ insert: txInsert }),
      );

      const outerInsertCallsBefore = db.insert.mock.calls.length;

      await service.createDirectChannel('u-1', 'u-1', 't-1');

      // Both the channel row and the member row must have been routed
      // through the tx.insert argument, not the outer db.insert.
      expect(txInsert).toHaveBeenCalledTimes(2);
      expect(db.insert.mock.calls.length).toBe(outerInsertCallsBefore);
    });

    it('reuses an orphaned echo channel (no member row) and heals membership', async () => {
      const orphaned = {
        id: 'echo-orphan',
        tenantId: 'tenant-1',
        type: 'echo',
        createdBy: 'user-1',
      };
      // Existing-channel lookup: orphaned echo row found.
      db.limit.mockResolvedValueOnce([orphaned] as any);
      // Membership lookup: no member row exists for the owner.
      db.limit.mockResolvedValueOnce([] as any);
      const memberCacheService = (service as any).channelMemberCacheService;
      const redisService = (service as any).redis;

      const result = await service.createDirectChannel(
        'user-1',
        'user-1',
        'tenant-1',
      );

      expect(result).toEqual(orphaned);
      // A member row must be inserted to heal the orphan, guarded by
      // onConflictDoNothing to stay safe under a concurrent self-heal.
      expect(db.insert).toHaveBeenCalled();
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'echo-orphan',
          userId: 'user-1',
          role: 'owner',
        }),
      );
      expect(db.onConflictDoNothing).toHaveBeenCalled();
      // Self-heal must invalidate the caches so stale reads don't linger.
      expect(memberCacheService.invalidate).toHaveBeenCalledWith('echo-orphan');
      expect(redisService.invalidate).toHaveBeenCalled();
    });

    it('reuses a healthy echo channel without touching inserts, updates, or caches', async () => {
      const existing = {
        id: 'echo-existing',
        tenantId: 'tenant-1',
        type: 'echo',
        createdBy: 'user-1',
      };
      // Existing-channel lookup: channel row found.
      db.limit.mockResolvedValueOnce([existing] as any);
      // Membership lookup: active owner membership already present.
      db.limit.mockResolvedValueOnce([{ id: 'member-1', leftAt: null }] as any);
      const memberCacheService = (service as any).channelMemberCacheService;
      const redisService = (service as any).redis;

      const result = await service.createDirectChannel(
        'user-1',
        'user-1',
        'tenant-1',
      );

      expect(result).toEqual(existing);
      expect(db.insert).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
      expect(db.transaction).not.toHaveBeenCalled();
      // No-op early return must not churn the caches.
      expect(memberCacheService.invalidate).not.toHaveBeenCalled();
      expect(redisService.invalidate).not.toHaveBeenCalled();
    });

    it('rejoins the owner when a previous membership was marked as left', async () => {
      const existing = {
        id: 'echo-existing',
        tenantId: 'tenant-1',
        type: 'echo',
        createdBy: 'user-1',
      };
      db.limit.mockResolvedValueOnce([existing] as any);
      // Membership lookup: row exists but the user had left.
      db.limit.mockResolvedValueOnce([
        { id: 'member-1', leftAt: new Date('2026-01-01') },
      ] as any);

      const result = await service.createDirectChannel(
        'user-1',
        'user-1',
        'tenant-1',
      );

      expect(result).toEqual(existing);
      // Rejoin should UPDATE the existing member row, not INSERT a new one.
      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          leftAt: null,
          role: 'owner',
          joinedAt: expect.any(Date),
        }),
      );
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('propagates a failure raised from inside the transaction callback', async () => {
      // No existing echo channel — force the create path.
      db.limit.mockResolvedValueOnce([] as any);
      // Simulate Drizzle: actually run the callback so that a failure
      // inside it (not just a pre-callback throw) bubbles up. This is
      // closer to the real code path than a throw-before-callback.
      const boom = new Error('db write failed');
      db.transaction.mockImplementationOnce(async (cb: any) => {
        const pretendTx = {
          insert: jest.fn<any>().mockReturnValue({
            values: jest.fn<any>().mockReturnValue({
              returning: jest.fn<any>().mockRejectedValue(boom),
            }),
          }),
        };
        // Drizzle would rethrow on callback rejection; replicate that.
        return await cb(pretendTx);
      });

      await expect(
        service.createDirectChannel('user-1', 'user-1', 'tenant-1'),
      ).rejects.toThrow('db write failed');
    });

    it('recovers from a TOCTOU race by re-reading the winner row when the unique index rejects the second INSERT', async () => {
      // Race scenario, after migration 0040 added a partial unique index
      // on (created_by, tenant_id) WHERE type='echo' AND is_archived=false.
      // Two concurrent requests both miss the existence check, both enter
      // the transaction. The first INSERT wins; the second hits a Postgres
      // unique-violation (SQLSTATE 23505), its transaction rolls back, and
      // getOrCreateEchoChannel must re-read the existing channel (created
      // by the winner) instead of bubbling the raw 23505 to the user.
      const winner = {
        id: 'echo-winner',
        tenantId: 'tenant-1',
        type: 'echo',
        createdBy: 'user-1',
        isArchived: false,
      };

      // Sequence of `.limit(1)` calls in the new code path:
      //   1) initial existence lookup → empty (race not yet visible)
      //   2) post-rollback re-lookup    → returns the winner row
      //   3) ensureEchoOwnerMembership member lookup → active member
      db.limit.mockResolvedValueOnce([] as any);
      db.limit.mockResolvedValueOnce([winner] as any);
      db.limit.mockResolvedValueOnce([{ id: 'member-1', leftAt: null }] as any);

      // Transaction simulates Drizzle propagating a Postgres unique
      // violation from the channel INSERT.
      const pgUniqueErr = Object.assign(new Error('duplicate key value'), {
        code: '23505',
        constraint: 'idx_echo_unique_owner_tenant',
      });
      db.transaction.mockImplementationOnce(async (cb: any) => {
        const pretendTx = {
          insert: jest.fn<any>().mockReturnValue({
            values: jest.fn<any>().mockReturnValue({
              returning: jest.fn<any>().mockRejectedValue(pgUniqueErr),
            }),
          }),
        };
        return await cb(pretendTx);
      });
      const memberCacheService = (service as any).channelMemberCacheService;
      const redisService = (service as any).redis;
      // Spy on the warn log so a future regression that drops the
      // observability hook will fail this test.
      const loggerWarnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);

      const result = await service.createDirectChannel(
        'user-1',
        'user-1',
        'tenant-1',
      );

      expect(result).toEqual(winner);
      // The unique violation must NOT propagate.
      // (If it did, `.resolves.toEqual(winner)` above would already fail.)
      // Recovery must observe (warn log) the race for ops visibility.
      expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
      expect(loggerWarnSpy.mock.calls[0][0]).toContain('TOCTOU');
      // The recovery path must NOT re-enter the transaction or churn caches:
      // the winner already invalidated them in its successful path, and
      // ensureEchoOwnerMembership early-returns on an active member.
      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(memberCacheService.invalidate).not.toHaveBeenCalled();
      expect(redisService.invalidate).not.toHaveBeenCalled();

      loggerWarnSpy.mockRestore();
    });

    it('still propagates non-unique-violation database errors raised inside the transaction', async () => {
      // Regression guard: the unique-violation recovery added above
      // must NOT swallow other database failures (constraint checks,
      // connection drops, etc).
      db.limit.mockResolvedValueOnce([] as any);
      const otherErr = Object.assign(new Error('connection lost'), {
        code: '08006',
      });
      db.transaction.mockImplementationOnce(async (cb: any) => {
        const pretendTx = {
          insert: jest.fn<any>().mockReturnValue({
            values: jest.fn<any>().mockReturnValue({
              returning: jest.fn<any>().mockRejectedValue(otherErr),
            }),
          }),
        };
        return await cb(pretendTx);
      });

      await expect(
        service.createDirectChannel('user-1', 'user-1', 'tenant-1'),
      ).rejects.toThrow('connection lost');
      // Catch must fall straight through — no re-read on non-23505 errors.
      // (Only 1 limit call was queued; if the catch tried to re-read it
      // would consume a non-existent second mock and explode visibly.)
      expect(db.limit).toHaveBeenCalledTimes(1);
    });

    it('does not call assertDirectMessageAllowed for self-chat', async () => {
      const assertSpy = jest.spyOn(
        service as any,
        'assertDirectMessageAllowed',
      );

      // No existing echo channel.
      db.limit.mockResolvedValueOnce([] as any);
      db.returning.mockResolvedValueOnce([
        { id: 'echo-new', type: 'echo', createdBy: 'user-1' },
      ] as any);

      await service.createDirectChannel('user-1', 'user-1');

      expect(assertSpy).not.toHaveBeenCalled();

      assertSpy.mockRestore();
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

    it('throws BadRequestException when mentioning a restricted personal staff bot', async () => {
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
      ).rejects.toThrow(BadRequestException);
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

  describe('getChannelMembers', () => {
    it('classifies a common-staff bot member into staffKind=common with roleTitle', async () => {
      // Mocks the post-Task-2 join shape: each row carries botExtra (jsonb)
      // plus ownerDisplayName / ownerUsername from the aliased ownerUser
      // join. For a common-staff bot, ownerId is null so the owner-side
      // fields come back null. This exercises the full
      // service.getChannelMembers wiring (select shape → mapChannelUserSummary
      // → ChannelMemberResponse) rather than calling the private mapper
      // directly.
      const botExtra: BotExtra = {
        commonStaff: { roleTitle: 'HR Lead' },
      };

      db.where.mockResolvedValueOnce([
        {
          id: 'cm-bot-1',
          userId: 'bot-1',
          role: 'member',
          isMuted: false,
          notificationsEnabled: true,
          joinedAt: new Date('2026-04-01T00:00:00Z'),
          username: 'hr-bot',
          displayName: 'HR Bot',
          avatarUrl: null,
          status: 'online',
          userType: 'bot',
          createdAt: new Date('2026-04-01T00:00:00Z'),
          applicationId: 'common-staff',
          managedProvider: null,
          managedMeta: null,
          botExtra,
          ownerDisplayName: null,
          ownerUsername: null,
        },
      ] as any);

      const result = await service.getChannelMembers('channel-1');

      expect(result).toHaveLength(1);
      expect(result[0].user.staffKind).toBe('common');
      expect(result[0].user.roleTitle).toBe('HR Lead');
      expect(result[0].user.ownerName).toBeNull();
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
    let botService: { findActiveBotsByMentorId: MockFn };

    beforeEach(() => {
      redisService = (service as any).redis;
      botService = (service as any).botService;
    });

    it('should pass when user is a direct channel member', async () => {
      // assertReadAccess now calls findById first, then isChannelMember.
      // findById → returns private channel with tenantId
      redisService.getOrSet = jest.fn<any>().mockResolvedValueOnce({
        id: 'ch-1',
        type: 'private',
        tenantId: 't-1',
      });
      // isChannelMember → getEffectiveRole → resolveEffectiveMembership:
      // botService returns no mentored bots, but db.where returns user as direct owner
      botService.findActiveBotsByMentorId = jest
        .fn<any>()
        .mockResolvedValueOnce([]);
      db.where.mockResolvedValueOnce([
        { channelId: 'ch-1', userId: 'user-1', role: 'owner' },
      ]);

      await expect(
        service.assertReadAccess('ch-1', 'user-1'),
      ).resolves.toBeUndefined();
    });

    it('should pass for public channel when user is not a member', async () => {
      // findById → public channel with tenantId
      redisService.getOrSet = jest
        .fn<any>()
        .mockResolvedValueOnce({ id: 'ch-1', type: 'public', tenantId: 't-1' });
      // isChannelMember → getEffectiveRole → no bots, no direct membership → null
      botService.findActiveBotsByMentorId = jest
        .fn<any>()
        .mockResolvedValueOnce([]);
      db.where.mockResolvedValueOnce([]); // no membership rows

      await expect(
        service.assertReadAccess('ch-1', 'user-1'),
      ).resolves.toBeUndefined();
    });

    it('should pass for tracking channel when user is a tenant member', async () => {
      // findById → tracking channel
      redisService.getOrSet = jest.fn<any>().mockResolvedValueOnce({
        id: 'ch-1',
        type: 'tracking',
        tenantId: 't-1',
      });
      // isChannelMember → getEffectiveRole → no bots, no direct membership → null
      botService.findActiveBotsByMentorId = jest
        .fn<any>()
        .mockResolvedValueOnce([]);
      db.where.mockResolvedValueOnce([]); // no membership
      // isUserInTenant → found
      db.limit.mockResolvedValueOnce([{ id: 'member-1' }]);

      await expect(
        service.assertReadAccess('ch-1', 'user-1'),
      ).resolves.toBeUndefined();
    });

    it('should throw for tracking channel when user is NOT a tenant member', async () => {
      // findById → tracking channel
      redisService.getOrSet = jest.fn<any>().mockResolvedValueOnce({
        id: 'ch-1',
        type: 'tracking',
        tenantId: 't-1',
      });
      // isChannelMember → no membership
      botService.findActiveBotsByMentorId = jest
        .fn<any>()
        .mockResolvedValueOnce([]);
      db.where.mockResolvedValueOnce([]);
      // isUserInTenant → not found
      db.limit.mockResolvedValueOnce([]);

      await expect(service.assertReadAccess('ch-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw for tracking channel with null tenantId', async () => {
      // findById → tracking channel without tenantId
      redisService.getOrSet = jest.fn<any>().mockResolvedValueOnce({
        id: 'ch-1',
        type: 'tracking',
        tenantId: null,
      });
      // isChannelMember is skipped (no tenantId); falls back to isMember → getMemberRole
      redisService.getOrSet.mockResolvedValueOnce(null); // getMemberRole → not member

      await expect(service.assertReadAccess('ch-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw for non-existent channel', async () => {
      // findById → null
      redisService.getOrSet = jest.fn<any>().mockResolvedValueOnce(null);

      await expect(
        service.assertReadAccess('nonexistent', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw for private channel when user is not a member', async () => {
      // findById → private channel with tenantId
      redisService.getOrSet = jest.fn<any>().mockResolvedValueOnce({
        id: 'ch-1',
        type: 'private',
        tenantId: 't-1',
      });
      // isChannelMember → no bots, no direct membership → null
      botService.findActiveBotsByMentorId = jest
        .fn<any>()
        .mockResolvedValueOnce([]);
      db.where.mockResolvedValueOnce([]);

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
        ] as any)
        // resolveEffectiveMembership DB query (no derived channels since botService returns [])
        .mockResolvedValueOnce([] as any);

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

    it('should include showInDmSidebar in result', async () => {
      const mockChannel = {
        id: 'ch-1',
        tenantId: 'tenant-1',
        name: null,
        description: null,
        type: 'direct',
        avatarUrl: null,
        createdBy: 'user-1',
        sectionId: null,
        order: 0,
        isArchived: false,
        isActivated: true,
        snapshot: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        unreadCount: 0,
        lastReadMessageId: null,
        showInDmSidebar: true,
      };
      db.where.mockResolvedValueOnce([mockChannel] as any);
      db.where.mockResolvedValueOnce([] as any);
      // resolveEffectiveMembership DB query (no derived channels)
      db.where.mockResolvedValueOnce([] as any);
      const result = await service.getUserChannels('user-1', 'tenant-1');
      expect(result[0]).toHaveProperty('showInDmSidebar', true);
    });

    it('should pass showInDmSidebar=false when field is false', async () => {
      const mockChannel = {
        id: 'ch-2',
        tenantId: 'tenant-1',
        name: null,
        description: null,
        type: 'direct',
        avatarUrl: null,
        createdBy: 'user-1',
        sectionId: null,
        order: 0,
        isArchived: false,
        isActivated: true,
        snapshot: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        unreadCount: 0,
        lastReadMessageId: null,
        showInDmSidebar: false,
      };
      db.where.mockResolvedValueOnce([mockChannel] as any);
      // Second where call: batch member fetch for direct channels
      db.where.mockResolvedValueOnce([] as any);
      // resolveEffectiveMembership DB query (no derived channels)
      db.where.mockResolvedValueOnce([] as any);
      const result = await service.getUserChannels('user-1', 'tenant-1');
      expect(result[0]).toHaveProperty('showInDmSidebar', false);
    });

    it('classifies a bot DM peer with commonStaff extra into staffKind=common', async () => {
      // Mocks the post-Task-2 join shape: the per-member query now returns
      // botExtra (jsonb) alongside ownerDisplayName / ownerUsername from
      // the aliased ownerUser join. For a common-staff bot, ownerId is null
      // so the owner-side fields come back null.
      const botExtra: BotExtra = {
        commonStaff: { roleTitle: 'HR Lead' },
      };

      db.where
        .mockResolvedValueOnce([
          {
            id: 'direct-bot-1',
            tenantId: 'tenant-1',
            name: 'dm-with-bot',
            description: null,
            type: 'direct',
            avatarUrl: null,
            createdBy: 'user-1',
            sectionId: null,
            order: 0,
            isArchived: false,
            isActivated: true,
            snapshot: null,
            createdAt: new Date('2026-04-01T00:00:00Z'),
            updatedAt: new Date('2026-04-01T00:00:00Z'),
            unreadCount: 0,
            lastReadMessageId: null,
          },
        ] as any)
        .mockResolvedValueOnce([
          {
            channelId: 'direct-bot-1',
            userId: 'user-1',
            username: 'alice',
            displayName: 'Alice',
            avatarUrl: null,
            status: 'online',
            userType: 'human',
            applicationId: null,
            managedProvider: null,
            managedMeta: null,
            botExtra: null,
            ownerDisplayName: null,
            ownerUsername: null,
          },
          {
            channelId: 'direct-bot-1',
            userId: 'bot-1',
            username: 'hr-bot',
            displayName: 'HR Bot',
            avatarUrl: null,
            status: 'online',
            userType: 'bot',
            applicationId: 'common-staff',
            managedProvider: null,
            managedMeta: null,
            botExtra,
            ownerDisplayName: null,
            ownerUsername: null,
          },
        ] as any)
        // resolveEffectiveMembership DB query (no derived channels)
        .mockResolvedValueOnce([] as any);

      const result = await service.getUserChannels('user-1', 'tenant-1');

      const dmChannel = result.find((ch) => ch.type === 'direct');
      expect(dmChannel?.otherUser).toMatchObject({
        id: 'bot-1',
        userType: 'bot',
        staffKind: 'common',
        roleTitle: 'HR Lead',
        ownerName: null,
      });
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

      jest.spyOn(service, 'getEffectiveRole').mockResolvedValue('admin');
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
      jest.spyOn(service, 'getEffectiveRole').mockResolvedValue('owner');
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

      jest.spyOn(service, 'getEffectiveRole').mockResolvedValue('owner');
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

      jest.spyOn(service, 'getEffectiveRole').mockResolvedValue('owner');
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

  describe('archiveCreationChannel', () => {
    let redisService: { invalidate: MockFn };

    beforeEach(() => {
      redisService = (service as any).redis;
    });

    it('archives a routine-session channel without role check', async () => {
      db.limit.mockResolvedValueOnce([
        { id: 'ch-rs', type: 'routine-session', isArchived: false },
      ] as any);

      await service.archiveCreationChannel('ch-rs');

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ isArchived: true }),
      );
      expect(redisService.invalidate).toHaveBeenCalled();
    });

    it('rejects non-routine-session channels with ForbiddenException', async () => {
      db.limit.mockResolvedValueOnce([
        { id: 'ch-direct', type: 'direct', isArchived: false },
      ] as any);

      await expect(service.archiveCreationChannel('ch-direct')).rejects.toThrow(
        ForbiddenException,
      );
      expect(db.update).not.toHaveBeenCalled();
    });

    it('is idempotent when channel is already archived', async () => {
      db.limit.mockResolvedValueOnce([
        { id: 'ch-rs', type: 'routine-session', isArchived: true },
      ] as any);

      await service.archiveCreationChannel('ch-rs');

      expect(db.update).not.toHaveBeenCalled();
      expect(redisService.invalidate).not.toHaveBeenCalled();
    });

    it('is a no-op and does not throw when channel is missing', async () => {
      db.limit.mockResolvedValueOnce([] as any);
      const debugSpy = jest.spyOn((service as any).logger, 'debug');

      await expect(
        service.archiveCreationChannel('nonexistent'),
      ).resolves.toBeUndefined();

      expect(db.update).not.toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('not found'),
      );
    });

    it('applies tenant filter when tenantId is provided', async () => {
      db.limit.mockResolvedValueOnce([
        { id: 'ch-1', type: 'routine-session', isArchived: false },
      ] as any);

      await service.archiveCreationChannel('ch-1', 'tenant-42');

      expect(db.update).toHaveBeenCalled();
      expect(redisService.invalidate).toHaveBeenCalled();
    });
  });

  describe('setSidebarVisibility', () => {
    it('should update show_in_dm_sidebar for a direct channel', async () => {
      // Mock channel lookup
      db.limit.mockResolvedValueOnce([
        { id: 'channel-1', type: 'direct' },
      ] as any);
      // Mock member lookup
      db.limit.mockResolvedValueOnce([{ id: 'member-1' }] as any);

      await service.setSidebarVisibility('channel-1', 'user-1', false);
      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ showInDmSidebar: false }),
      );
    });

    it('should update show_in_dm_sidebar for an echo channel', async () => {
      db.limit.mockResolvedValueOnce([
        { id: 'channel-1', type: 'echo' },
      ] as any);
      db.limit.mockResolvedValueOnce([{ id: 'member-1' }] as any);

      await service.setSidebarVisibility('channel-1', 'user-1', true);
      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ showInDmSidebar: true }),
      );
    });

    it('should throw BadRequestException for non-DM channel', async () => {
      db.limit.mockResolvedValueOnce([
        { id: 'channel-1', type: 'public' },
      ] as any);
      await expect(
        service.setSidebarVisibility('channel-1', 'user-1', false),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for private channel', async () => {
      db.limit.mockResolvedValueOnce([
        { id: 'channel-1', type: 'private' },
      ] as any);
      await expect(
        service.setSidebarVisibility('channel-1', 'user-1', true),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for missing channel', async () => {
      db.limit.mockResolvedValueOnce([] as any);
      await expect(
        service.setSidebarVisibility('channel-1', 'user-1', false),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for non-member', async () => {
      db.limit.mockResolvedValueOnce([
        { id: 'channel-1', type: 'direct' },
      ] as any);
      // No member found
      db.limit.mockResolvedValueOnce([] as any);
      await expect(
        service.setSidebarVisibility('channel-1', 'user-1', false),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createRoutineSessionChannel', () => {
    it('inserts channel + both members inside a single transaction with purpose metadata', async () => {
      // Arrange: channel insert returning() yields the new row
      db.returning.mockResolvedValueOnce([
        {
          id: 'ch-1',
          type: 'routine-session',
          tenantId: 'tenant-1',
          createdBy: 'user-1',
          propertySettings: {
            routineSession: { purpose: 'creation', routineId: 'routine-1' },
          },
        },
      ]);

      const result = await service.createRoutineSessionChannel({
        creatorId: 'user-1',
        botUserId: 'bot-user-1',
        tenantId: 'tenant-1',
        routineId: 'routine-1',
        purpose: 'creation',
      });

      // Entered a transaction
      expect(db.transaction).toHaveBeenCalledTimes(1);

      // Inside the tx: one insert for the channel row, one insert for
      // both channel_member rows — 2 inserts total
      expect(db.insert).toHaveBeenCalledTimes(2);

      // Channel insert values include correct type + propertySettings shape
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'routine-session',
          tenantId: 'tenant-1',
          createdBy: 'user-1',
          name: null,
          propertySettings: {
            routineSession: { purpose: 'creation', routineId: 'routine-1' },
          },
        }),
      );

      // Member batch insert receives both rows
      expect(db.values).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            channelId: 'ch-1',
            userId: 'user-1',
            role: 'member',
          }),
          expect.objectContaining({
            channelId: 'ch-1',
            userId: 'bot-user-1',
            role: 'member',
          }),
        ]),
      );

      expect(result.id).toBe('ch-1');
      expect(result.type).toBe('routine-session');
    });

    it('rolls back channel insert when member insert fails (atomic)', async () => {
      // First insert (channel) succeeds — returning yields a row
      db.returning.mockResolvedValueOnce([
        { id: 'ch-2', type: 'routine-session', tenantId: 'tenant-1' },
      ]);

      // Simulate the second insert (members batch) throwing.
      // The default mockDb transaction helper delegates cb(chain); we
      // override the tx delegate to make the second values() throw.
      let insertCount = 0;
      db.values.mockImplementation(() => {
        insertCount += 1;
        if (insertCount === 2) {
          throw new Error('members insert failed');
        }
        return db as any;
      });

      await expect(
        service.createRoutineSessionChannel({
          creatorId: 'user-1',
          botUserId: 'bot-user-1',
          tenantId: 'tenant-1',
          routineId: 'routine-1',
          purpose: 'creation',
        }),
      ).rejects.toThrow('members insert failed');

      // Post-commit cache invalidation must NOT have run because the
      // transaction callback threw before returning
      expect(
        (service as any).channelMemberCacheService.invalidate,
      ).not.toHaveBeenCalled();
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

  describe('hardDeleteRoutineSessionChannel', () => {
    it('throws NotFoundException when channel missing', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(
        service.hardDeleteRoutineSessionChannel('missing-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when channel is not routine-session', async () => {
      db.limit.mockResolvedValueOnce([
        { id: 'ch-1', type: 'direct', tenantId: 't-1' },
      ]);

      await expect(
        service.hardDeleteRoutineSessionChannel('ch-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when tenantId provided does not match', async () => {
      db.limit.mockResolvedValueOnce([
        { id: 'ch-1', type: 'routine-session', tenantId: 'other-tenant' },
      ]);

      await expect(
        service.hardDeleteRoutineSessionChannel('ch-1', 't-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deletes audit logs and channel inside a transaction, then invalidates cache', async () => {
      db.limit.mockResolvedValueOnce([
        { id: 'ch-1', type: 'routine-session', tenantId: 't-1' },
      ]);

      await service.hardDeleteRoutineSessionChannel('ch-1', 't-1');

      // transaction was used
      expect(db.transaction).toHaveBeenCalledTimes(1);

      // Both deletes ran inside the transaction body — the mockDb helper
      // passes the chain itself as the tx argument, so we assert on chain.delete.
      // Expect at least 2 delete() invocations (auditLogs + channels).
      expect(db.delete).toHaveBeenCalledTimes(2);

      // Redis invalidation ran after the transaction
      const redisService = (service as any).redis as {
        invalidate: jest.Mock;
      };
      expect(redisService.invalidate).toHaveBeenCalledWith(
        expect.stringContaining('ch-1'),
      );
    });
  });

  // ── mapChannelUserSummary ───────────────────────────────────────────

  describe('mapChannelUserSummary', () => {
    type SummaryRow = {
      userId: string;
      username: string;
      displayName: string | null;
      avatarUrl: string | null;
      status: 'online' | 'offline' | 'away' | 'busy';
      userType: 'human' | 'bot' | 'system';
      applicationId: string | null;
      managedProvider: string | null;
      managedMeta: Record<string, unknown> | null;
      botExtra: BotExtra | null;
      ownerDisplayName: string | null;
      ownerUsername: string | null;
    };

    const baseRow: SummaryRow = {
      userId: 'u1',
      username: 'alice',
      displayName: 'Alice',
      avatarUrl: null,
      status: 'online',
      userType: 'bot',
      applicationId: null,
      managedProvider: null,
      managedMeta: null,
      botExtra: null,
      ownerDisplayName: null,
      ownerUsername: null,
    };

    const map = (row: SummaryRow) =>
      (
        service as unknown as {
          mapChannelUserSummary: (r: SummaryRow) => {
            id: string;
            username: string;
            displayName: string | null;
            avatarUrl: string | null;
            status: 'online' | 'offline' | 'away' | 'busy';
            userType: 'human' | 'bot' | 'system';
            agentType: string | null;
            staffKind: 'common' | 'personal' | 'other' | null;
            roleTitle: string | null;
            ownerName: string | null;
          };
        }
      ).mapChannelUserSummary(row);

    it('common staff with roleTitle → staffKind=common, roleTitle set', () => {
      const result = map({
        ...baseRow,
        botExtra: { commonStaff: { roleTitle: 'Engineer' } },
      });

      expect(result.staffKind).toBe('common');
      expect(result.roleTitle).toBe('Engineer');
      expect(result.ownerName).toBeNull();
    });

    it('common staff without roleTitle → staffKind=common, roleTitle=null', () => {
      const result = map({
        ...baseRow,
        botExtra: { commonStaff: {} },
      });

      expect(result.staffKind).toBe('common');
      expect(result.roleTitle).toBeNull();
      expect(result.ownerName).toBeNull();
    });

    it('personal staff with owner displayName → ownerName uses displayName', () => {
      const result = map({
        ...baseRow,
        botExtra: { personalStaff: {} },
        ownerDisplayName: 'Bob Owner',
        ownerUsername: 'bob',
      });

      expect(result.staffKind).toBe('personal');
      expect(result.roleTitle).toBeNull();
      expect(result.ownerName).toBe('Bob Owner');
    });

    it('personal staff with only username → ownerName falls back to username', () => {
      const result = map({
        ...baseRow,
        botExtra: { personalStaff: {} },
        ownerDisplayName: null,
        ownerUsername: 'bob',
      });

      expect(result.staffKind).toBe('personal');
      expect(result.ownerName).toBe('bob');
    });

    it('personal staff with missing owner row → ownerName=null', () => {
      const result = map({
        ...baseRow,
        botExtra: { personalStaff: {} },
        ownerDisplayName: null,
        ownerUsername: null,
      });

      expect(result.staffKind).toBe('personal');
      expect(result.ownerName).toBeNull();
    });

    it('bot with empty extra → staffKind=null (openclaw/base-model use agentType)', () => {
      const result = map({
        ...baseRow,
        botExtra: {},
      });

      expect(result.staffKind).toBeNull();
      expect(result.roleTitle).toBeNull();
      expect(result.ownerName).toBeNull();
    });

    it('human row → staffKind=null and other agent fields null', () => {
      const result = map({
        ...baseRow,
        userType: 'human',
        botExtra: null,
      });

      expect(result.staffKind).toBeNull();
      expect(result.roleTitle).toBeNull();
      expect(result.ownerName).toBeNull();
    });

    it('system user row → staffKind=null and other agent fields null', () => {
      const result = map({
        ...baseRow,
        userType: 'system',
        botExtra: null,
      });
      expect(result.staffKind).toBeNull();
      expect(result.roleTitle).toBeNull();
      expect(result.ownerName).toBeNull();
    });

    it('bot with both commonStaff and personalStaff → common wins (and warns)', () => {
      const logger = (service as unknown as { logger: { warn: jest.Mock } })
        .logger;
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});

      const result = map({
        ...baseRow,
        botExtra: {
          commonStaff: { roleTitle: 'Engineer' },
          personalStaff: {},
        },
        ownerDisplayName: 'Bob Owner',
        ownerUsername: 'bob',
      });

      expect(result.staffKind).toBe('common');
      expect(result.roleTitle).toBe('Engineer');
      expect(result.ownerName).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('u1');

      warnSpy.mockRestore();
    });
  });

  // ── assertBotCanDm ────────────────────────────────────────────────────

  describe('assertBotCanDm', () => {
    // Helpers to set up the sequential db.limit mock resolutions used by
    // assertBotCanDm:
    //   1st call → bot row
    //   2nd call → target user row
    //   3rd call → tenant_members membership row

    const BOT_TENANT_ID = 'tenant-abc';

    function mockBotRow(
      override: Partial<{
        userId: string;
        ownerId: string | null;
        mentorId: string | null;
        extra: BotExtra;
      }> = {},
    ) {
      return {
        userId: 'bot-1',
        ownerId: 'owner-1',
        mentorId: null,
        extra: {} as BotExtra,
        ...override,
      };
    }

    function mockTargetRow(
      override: Partial<{
        id: string;
        isBot: boolean;
      }> = {},
    ) {
      return {
        id: 'user-2',
        isBot: false,
        ...override,
      };
    }

    /** Stub the tenant_members lookup to return a matching membership row. */
    function stubMembershipFound(userId = 'user-2') {
      db.limit.mockResolvedValueOnce([{ userId }] as any);
    }

    /** Stub the tenant_members lookup to return an empty result (cross-tenant). */
    function stubMembershipNotFound() {
      db.limit.mockResolvedValueOnce([] as any);
    }

    it('throws BadRequestException(SELF_DM) when botUserId === targetUserId', async () => {
      await expect(
        service.assertBotCanDm('bot-1', 'bot-1', BOT_TENANT_ID),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.assertBotCanDm('bot-1', 'bot-1', BOT_TENANT_ID),
      ).rejects.toMatchObject({ message: 'SELF_DM' });

      // Self-DM guard must short-circuit before any DB calls
      expect(db.select).not.toHaveBeenCalled();
    });

    it('throws NotFoundException(BOT_NOT_FOUND) when bot row is missing', async () => {
      // Bot lookup returns nothing
      db.limit.mockResolvedValueOnce([] as any);

      await expect(
        service.assertBotCanDm('bot-missing', 'user-2', BOT_TENANT_ID),
      ).rejects.toThrow(NotFoundException);

      await expect(
        (async () => {
          db.limit.mockResolvedValueOnce([] as any);
          await service.assertBotCanDm('bot-missing', 'user-2', BOT_TENANT_ID);
        })(),
      ).rejects.toMatchObject({ message: 'BOT_NOT_FOUND' });
    });

    it('throws NotFoundException(USER_NOT_FOUND) when target user row is missing', async () => {
      db.limit.mockResolvedValueOnce([mockBotRow()] as any);
      db.limit.mockResolvedValueOnce([] as any);

      await expect(
        service.assertBotCanDm('bot-1', 'user-missing', BOT_TENANT_ID),
      ).rejects.toThrow(NotFoundException);

      db.limit.mockResolvedValueOnce([mockBotRow()] as any);
      db.limit.mockResolvedValueOnce([] as any);

      await expect(
        service.assertBotCanDm('bot-1', 'user-missing', BOT_TENANT_ID),
      ).rejects.toMatchObject({ message: 'USER_NOT_FOUND' });
    });

    it('throws ForbiddenException(DM_NOT_ALLOWED) when target is itself a bot', async () => {
      db.limit.mockResolvedValueOnce([mockBotRow()] as any);
      db.limit.mockResolvedValueOnce([mockTargetRow({ isBot: true })] as any);

      await expect(
        service.assertBotCanDm('bot-1', 'another-bot', BOT_TENANT_ID),
      ).rejects.toThrow(ForbiddenException);

      db.limit.mockResolvedValueOnce([mockBotRow()] as any);
      db.limit.mockResolvedValueOnce([mockTargetRow({ isBot: true })] as any);

      await expect(
        service.assertBotCanDm('bot-1', 'another-bot', BOT_TENANT_ID),
      ).rejects.toMatchObject({ message: 'DM_NOT_ALLOWED' });
    });

    it('throws BadRequestException(CROSS_TENANT) when target is not a tenant member', async () => {
      db.limit.mockResolvedValueOnce([mockBotRow()] as any);
      db.limit.mockResolvedValueOnce([mockTargetRow({ id: 'user-2' })] as any);
      stubMembershipNotFound();

      await expect(
        service.assertBotCanDm('bot-1', 'user-2', BOT_TENANT_ID),
      ).rejects.toThrow(BadRequestException);

      db.limit.mockResolvedValueOnce([mockBotRow()] as any);
      db.limit.mockResolvedValueOnce([mockTargetRow({ id: 'user-2' })] as any);
      stubMembershipNotFound();

      await expect(
        service.assertBotCanDm('bot-1', 'user-2', BOT_TENANT_ID),
      ).rejects.toMatchObject({ message: 'CROSS_TENANT' });
    });

    it('default policy: personalStaff bot → owner-only, allows the owner', async () => {
      const extra: BotExtra = { personalStaff: {} };
      db.limit.mockResolvedValueOnce([
        mockBotRow({ ownerId: 'owner-1', extra }),
      ] as any);
      db.limit.mockResolvedValueOnce([mockTargetRow({ id: 'owner-1' })] as any);
      stubMembershipFound('owner-1');

      await expect(
        service.assertBotCanDm('bot-1', 'owner-1', BOT_TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('default policy: personalStaff bot → owner-only, rejects non-owner', async () => {
      const extra: BotExtra = { personalStaff: {} };
      db.limit.mockResolvedValueOnce([
        mockBotRow({ ownerId: 'owner-1', extra }),
      ] as any);
      db.limit.mockResolvedValueOnce([
        mockTargetRow({ id: 'user-other' }),
      ] as any);
      stubMembershipFound('user-other');

      await expect(
        service.assertBotCanDm('bot-1', 'user-other', BOT_TENANT_ID),
      ).rejects.toThrow(ForbiddenException);

      db.limit.mockResolvedValueOnce([
        mockBotRow({ ownerId: 'owner-1', extra }),
      ] as any);
      db.limit.mockResolvedValueOnce([
        mockTargetRow({ id: 'user-other' }),
      ] as any);
      stubMembershipFound('user-other');

      await expect(
        service.assertBotCanDm('bot-1', 'user-other', BOT_TENANT_ID),
      ).rejects.toMatchObject({ message: 'DM_NOT_ALLOWED' });
    });

    it('default policy: commonStaff bot → same-tenant, allows any non-bot tenant member', async () => {
      const extra: BotExtra = { commonStaff: {} };
      db.limit.mockResolvedValueOnce([
        mockBotRow({ ownerId: null, extra }),
      ] as any);
      db.limit.mockResolvedValueOnce([
        mockTargetRow({ id: 'user-any' }),
      ] as any);
      stubMembershipFound('user-any');

      await expect(
        service.assertBotCanDm('bot-1', 'user-any', BOT_TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('default policy: unclassified bot → owner-only, rejects non-owner', async () => {
      const extra: BotExtra = {}; // no personalStaff, no commonStaff
      db.limit.mockResolvedValueOnce([
        mockBotRow({ ownerId: 'owner-1', extra }),
      ] as any);
      db.limit.mockResolvedValueOnce([
        mockTargetRow({ id: 'random-user' }),
      ] as any);
      stubMembershipFound('random-user');

      await expect(
        service.assertBotCanDm('bot-1', 'random-user', BOT_TENANT_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('explicit whitelist policy: allows a listed user', async () => {
      const extra: BotExtra = {
        dmOutboundPolicy: {
          mode: 'whitelist',
          userIds: ['allowed-1', 'allowed-2'],
        },
      };
      db.limit.mockResolvedValueOnce([mockBotRow({ extra })] as any);
      db.limit.mockResolvedValueOnce([
        mockTargetRow({ id: 'allowed-1' }),
      ] as any);
      stubMembershipFound('allowed-1');

      await expect(
        service.assertBotCanDm('bot-1', 'allowed-1', BOT_TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('explicit whitelist policy: rejects an unlisted user', async () => {
      const extra: BotExtra = {
        dmOutboundPolicy: { mode: 'whitelist', userIds: ['allowed-1'] },
      };
      db.limit.mockResolvedValueOnce([mockBotRow({ extra })] as any);
      db.limit.mockResolvedValueOnce([
        mockTargetRow({ id: 'not-listed' }),
      ] as any);
      stubMembershipFound('not-listed');

      await expect(
        service.assertBotCanDm('bot-1', 'not-listed', BOT_TENANT_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('explicit anyone policy: allows any same-tenant user', async () => {
      const extra: BotExtra = {
        dmOutboundPolicy: { mode: 'anyone' },
      };
      db.limit.mockResolvedValueOnce([mockBotRow({ extra })] as any);
      db.limit.mockResolvedValueOnce([
        mockTargetRow({ id: 'any-user' }),
      ] as any);
      stubMembershipFound('any-user');

      await expect(
        service.assertBotCanDm('bot-1', 'any-user', BOT_TENANT_ID),
      ).resolves.toBeUndefined();
    });
  });

  // ── defaultDmOutboundPolicy (module-level helper) ─────────────────────

  describe('defaultDmOutboundPolicy', () => {
    it('returns owner-only for personalStaff bots', () => {
      const extra: BotExtra = { personalStaff: {} };
      expect(defaultDmOutboundPolicy(extra)).toEqual({ mode: 'owner-only' });
    });

    it('returns same-tenant for commonStaff bots', () => {
      const extra: BotExtra = { commonStaff: {} };
      expect(defaultDmOutboundPolicy(extra)).toEqual({ mode: 'same-tenant' });
    });

    it('returns owner-only when neither personalStaff nor commonStaff is set', () => {
      const extra: BotExtra = {};
      expect(defaultDmOutboundPolicy(extra)).toEqual({ mode: 'owner-only' });
    });

    it('personalStaff takes precedence over commonStaff when both are present', () => {
      // This is an unexpected/corrupted state, but personalStaff is checked
      // first so it wins (mirrors the existing corruption logic in service).
      const extra: BotExtra = { personalStaff: {}, commonStaff: {} };
      expect(defaultDmOutboundPolicy(extra)).toEqual({ mode: 'owner-only' });
    });
  });

  // ── isTargetAllowed (module-level helper) ─────────────────────────────

  describe('isTargetAllowed', () => {
    it('owner-only: returns true when target is the owner', () => {
      const policy: DmOutboundPolicy = { mode: 'owner-only' };
      expect(isTargetAllowed(policy, { ownerId: 'owner-1' }, 'owner-1')).toBe(
        true,
      );
    });

    it('owner-only: returns false when target is not the owner', () => {
      const policy: DmOutboundPolicy = { mode: 'owner-only' };
      expect(
        isTargetAllowed(policy, { ownerId: 'owner-1' }, 'other-user'),
      ).toBe(false);
    });

    it('owner-only: returns false when ownerId is null', () => {
      const policy: DmOutboundPolicy = { mode: 'owner-only' };
      expect(isTargetAllowed(policy, { ownerId: null }, 'any-user')).toBe(
        false,
      );
    });

    it('same-tenant: always returns true', () => {
      const policy: DmOutboundPolicy = { mode: 'same-tenant' };
      expect(isTargetAllowed(policy, { ownerId: null }, 'any-user')).toBe(true);
      expect(
        isTargetAllowed(policy, { ownerId: 'owner-1' }, 'other-user'),
      ).toBe(true);
    });

    it('whitelist: returns true when targetId is in userIds', () => {
      const policy: DmOutboundPolicy = {
        mode: 'whitelist',
        userIds: ['u1', 'u2'],
      };
      expect(isTargetAllowed(policy, { ownerId: null }, 'u1')).toBe(true);
      expect(isTargetAllowed(policy, { ownerId: null }, 'u2')).toBe(true);
    });

    it('whitelist: returns false when targetId is not in userIds', () => {
      const policy: DmOutboundPolicy = { mode: 'whitelist', userIds: ['u1'] };
      expect(isTargetAllowed(policy, { ownerId: null }, 'u-not-listed')).toBe(
        false,
      );
    });

    it('whitelist: returns false when userIds is undefined', () => {
      const policy: DmOutboundPolicy = { mode: 'whitelist' };
      expect(isTargetAllowed(policy, { ownerId: null }, 'any-user')).toBe(
        false,
      );
    });

    it('anyone: always returns true', () => {
      const policy: DmOutboundPolicy = { mode: 'anyone' };
      expect(isTargetAllowed(policy, { ownerId: null }, 'any-user')).toBe(true);
      expect(
        isTargetAllowed(policy, { ownerId: 'owner-1' }, 'someone-else'),
      ).toBe(true);
    });
  });

  // ── filterBotUserIds ─────────────────────────────────────────────

  describe('filterBotUserIds', () => {
    it('returns an empty Set when given an empty array (no DB query)', async () => {
      const result = await service.filterBotUserIds([]);
      expect(result).toEqual(new Set());
      // No DB call should occur for an empty input
      expect(db.select).not.toHaveBeenCalled();
    });

    it('returns a Set containing only the userIds that appear in im_bots', async () => {
      // Simulate: two of the three supplied IDs are bots
      db.where.mockResolvedValueOnce([
        { userId: 'bot-1' },
        { userId: 'bot-2' },
      ] as any);

      const result = await service.filterBotUserIds([
        'bot-1',
        'human-1',
        'bot-2',
      ]);

      expect(result).toEqual(new Set(['bot-1', 'bot-2']));
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it('returns an empty Set when none of the supplied userIds are bots', async () => {
      db.where.mockResolvedValueOnce([] as any);

      const result = await service.filterBotUserIds(['human-1', 'human-2']);

      expect(result).toEqual(new Set());
    });

    it('handles a single userId that is a bot', async () => {
      db.where.mockResolvedValueOnce([{ userId: 'bot-only' }] as any);

      const result = await service.filterBotUserIds(['bot-only']);

      expect(result).toEqual(new Set(['bot-only']));
    });
  });
});
