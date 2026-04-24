/**
 * Integration tests for effective-membership wiring in ChannelsService.
 *
 * Extracted into a separate file so that jest.unstable_mockModule for
 * '@team9/database' (needed to assert on eq/isNull filter args) does not
 * interfere with the large existing channels.service.spec.ts which uses
 * static imports and a different mocking strategy.
 *
 * Covers spec §8.1 #12–#17.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import * as schema from '@team9/database/schemas';

// ── drizzle-orm helper spies ──────────────────────────────────────────────────
// These must be declared before jest.unstable_mockModule so the factory closure
// can capture them.

const mockEq = jest.fn((col: unknown, val: unknown) => ({ __eq: [col, val] }));
const mockAnd = jest.fn((...args: unknown[]) => ({
  __and: args.filter((a) => a !== undefined),
}));
const mockInArray = jest.fn((col: unknown, vals: unknown) => ({
  __inArray: [col, vals],
}));
const mockNotInArray = jest.fn((col: unknown, vals: unknown) => ({
  __notInArray: [col, vals],
}));
const mockIsNull = jest.fn((col: unknown) => ({ __isNull: col }));

// sql is a tagged template literal; mock it to return an object with .as()
// so queries using sql<number>`...`.as('alias') don't throw.
const sqlResult = { as: jest.fn((alias: unknown) => ({ __sqlAlias: alias })) };
const mockSql = Object.assign(
  jest.fn((..._args: unknown[]) => sqlResult),
  { empty: sqlResult },
) as unknown as typeof import('@team9/database').sql;

jest.unstable_mockModule('@team9/database', () => ({
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION_mock'),
  eq: mockEq,
  and: mockAnd,
  inArray: mockInArray,
  notInArray: mockNotInArray,
  isNull: mockIsNull,
  alias: jest.fn((table: unknown, name: unknown) => ({
    __alias: [table, name],
  })),
  sql: mockSql,
  desc: jest.fn((col: unknown) => ({ __desc: col })),
}));

const { ChannelsService, BOT_SERVICE_TOKEN } =
  await import('./channels.service.js');
const { DATABASE_CONNECTION } = await import('@team9/database');

import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from '@team9/redis';
import { ChannelMemberCacheService } from '../shared/channel-member-cache.service.js';
import { TabsService } from '../views/tabs.service.js';

// ── helpers ───────────────────────────────────────────────────────────────────

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
  chain.transaction = jest
    .fn<any>()
    .mockImplementation(async (cb: any) => cb(chain));
  return chain;
}

// ── constants ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-1';
const USER_ID = 'mentor-1';
const BOT_USER_ID = 'bot-1';
const CHANNEL_ID = 'chan-1';

const BASE_CHANNEL = {
  id: CHANNEL_ID,
  tenantId: TENANT_ID,
  name: 'ops',
  description: null,
  type: 'public' as const,
  avatarUrl: null,
  createdBy: BOT_USER_ID,
  sectionId: null,
  order: 0,
  isArchived: false,
  isActivated: true,
  snapshot: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── suite ─────────────────────────────────────────────────────────────────────

describe('ChannelsService — effective membership wiring (§8.1 #12–#17)', () => {
  let service: InstanceType<typeof ChannelsService>;
  let db: ReturnType<typeof mockDb>;
  let botServiceMock: {
    getBotMentorId: MockFn;
    findActiveBotsByMentorId: MockFn;
  };
  let redisMock: {
    getOrSet: MockFn;
    invalidate: MockFn;
    get: MockFn;
    set: MockFn;
    del: MockFn;
  };

  beforeEach(async () => {
    // Clear drizzle-orm spies between tests
    mockEq.mockClear();
    mockAnd.mockClear();
    mockInArray.mockClear();
    mockIsNull.mockClear();

    db = mockDb();

    botServiceMock = {
      getBotMentorId: jest.fn<any>().mockResolvedValue(null),
      findActiveBotsByMentorId: jest.fn<any>().mockResolvedValue([]),
    };

    redisMock = {
      get: jest.fn<any>().mockResolvedValue(null),
      set: jest.fn<any>().mockResolvedValue(undefined),
      del: jest.fn<any>().mockResolvedValue(undefined),
      getOrSet: jest.fn<any>().mockResolvedValue(null),
      invalidate: jest.fn<any>().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelsService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: RedisService, useValue: redisMock },
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
        { provide: BOT_SERVICE_TOKEN, useValue: botServiceMock },
      ],
    }).compile();

    service = module.get<InstanceType<typeof ChannelsService>>(ChannelsService);
  });

  // ── #12: getUserChannels UNIONs direct + mentor-derived, no duplicates ────────

  describe('#12 getUserChannels UNIONs direct + mentor-derived, no duplicates', () => {
    it('includes a mentor-derived channel not in the direct list', async () => {
      // Direct channels query: user is only a member of chan-direct
      const directChannel = {
        id: 'chan-direct',
        tenantId: TENANT_ID,
        name: 'direct-only',
        description: null,
        type: 'public',
        avatarUrl: null,
        createdBy: USER_ID,
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

      // botService returns one mentored bot
      botServiceMock.findActiveBotsByMentorId.mockResolvedValueOnce([
        { botUserId: BOT_USER_ID },
      ]);

      // getDirectUserChannels DB call (where terminates the query)
      db.where.mockResolvedValueOnce([directChannel] as any);

      // resolveEffectiveMembership DB call: bot is member of chan-1 (derived)
      db.where.mockResolvedValueOnce([
        { channelId: CHANNEL_ID, userId: BOT_USER_ID, role: 'owner' },
      ] as any);

      // fetchChannelsByIds DB call for derived-only channels (chan-1 not in direct)
      db.where.mockResolvedValueOnce([
        {
          ...BASE_CHANNEL,
          unreadCount: 0,
          lastReadMessageId: null,
        },
      ] as any);

      const result = await service.getUserChannels(USER_ID, TENANT_ID);

      // Both channels should be present, no duplicates
      expect(result).toHaveLength(2);
      const ids = result.map((c) => c.id);
      expect(ids).toContain('chan-direct');
      expect(ids).toContain(CHANNEL_ID);
    });

    it('no duplicate when derived channel is also in direct membership', async () => {
      // User is both a direct member AND mentors a bot on the same channel
      const directChannel = {
        id: CHANNEL_ID,
        tenantId: TENANT_ID,
        name: 'ops',
        description: null,
        type: 'public',
        avatarUrl: null,
        createdBy: BOT_USER_ID,
        sectionId: null,
        order: 0,
        isArchived: false,
        isActivated: true,
        snapshot: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        unreadCount: 5,
        lastReadMessageId: 'msg-100',
        showInDmSidebar: false,
      };

      botServiceMock.findActiveBotsByMentorId.mockResolvedValueOnce([
        { botUserId: BOT_USER_ID },
      ]);

      // Direct query returns chan-1 (user is direct member)
      db.where.mockResolvedValueOnce([directChannel] as any);

      // resolveEffectiveMembership also finds chan-1 (via bot)
      db.where.mockResolvedValueOnce([
        { channelId: CHANNEL_ID, userId: BOT_USER_ID, role: 'owner' },
      ] as any);

      const result = await service.getUserChannels(USER_ID, TENANT_ID);

      // chan-1 must appear exactly once; direct row is kept
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(CHANNEL_ID);
      expect(result[0].unreadCount).toBe(5); // from direct row
    });

    it('asserts eq(channels.tenantId, tenantId) filter is applied in effective membership query', async () => {
      botServiceMock.findActiveBotsByMentorId.mockResolvedValueOnce([
        { botUserId: BOT_USER_ID },
      ]);

      db.where.mockResolvedValueOnce([] as any); // direct channels
      db.where.mockResolvedValueOnce([] as any); // effective membership

      await service.getUserChannels(USER_ID, TENANT_ID);

      // The tenantId filter must be passed to eq()
      expect(mockEq).toHaveBeenCalledWith(schema.channels.tenantId, TENANT_ID);
    });

    it('asserts isNull(channelMembers.leftAt) filter is applied in effective membership query', async () => {
      botServiceMock.findActiveBotsByMentorId.mockResolvedValueOnce([
        { botUserId: BOT_USER_ID },
      ]);

      db.where.mockResolvedValueOnce([] as any); // direct channels
      db.where.mockResolvedValueOnce([] as any); // effective membership

      await service.getUserChannels(USER_ID, TENANT_ID);

      // The leftAt filter must be passed to isNull()
      expect(mockIsNull).toHaveBeenCalledWith(schema.channelMembers.leftAt);
    });
  });

  // ── #13: getEffectiveRole returns 'owner' when user mentors the owner bot ────

  describe('#13 getEffectiveRole returns owner when user mentors the owner bot', () => {
    it('returns owner when bot is owner and user is bot mentor', async () => {
      botServiceMock.findActiveBotsByMentorId.mockResolvedValueOnce([
        { botUserId: BOT_USER_ID },
      ]);

      // DB returns bot is owner of the channel
      db.where.mockResolvedValueOnce([
        { channelId: CHANNEL_ID, userId: BOT_USER_ID, role: 'owner' },
      ] as any);

      const role = await service.getEffectiveRole(
        CHANNEL_ID,
        USER_ID,
        TENANT_ID,
      );

      expect(role).toBe('owner');
      // Must have queried with the correct tenantId
      expect(mockEq).toHaveBeenCalledWith(schema.channels.tenantId, TENANT_ID);
      // Must have filtered out left members
      expect(mockIsNull).toHaveBeenCalledWith(schema.channelMembers.leftAt);
    });
  });

  // ── #14: After mentor switch, new mentor can call updateChannel ───────────────

  describe('#14 new mentor can updateChannel after mentor switch', () => {
    it('allows update when effective role is owner via mentor derivation', async () => {
      const updatedChannel = { ...BASE_CHANNEL, name: 'ops-renamed' };

      // getChannelTenantId → findById → redis.getOrSet returns null → then DB query
      // We mock findById via redis to return null (so falls back to getMemberRole path)
      // Instead, mock getEffectiveRole directly to isolate the auth guard test.
      jest.spyOn(service, 'getEffectiveRole').mockResolvedValueOnce('owner');
      // getChannelTenantId falls back via redis returning 'tenant-1'
      redisMock.getOrSet.mockResolvedValueOnce(BASE_CHANNEL as any);

      db.returning.mockResolvedValueOnce([updatedChannel] as any);

      await expect(
        service.update(CHANNEL_ID, { name: 'ops-renamed' } as any, USER_ID),
      ).resolves.toEqual(updatedChannel);
    });

    it('denies update when effective role is null (not a member, not a mentor)', async () => {
      jest.spyOn(service, 'getEffectiveRole').mockResolvedValueOnce(null);
      redisMock.getOrSet.mockResolvedValueOnce(BASE_CHANNEL as any);

      await expect(
        service.update(
          CHANNEL_ID,
          { name: 'ops-renamed' } as any,
          'stranger-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(db.update).not.toHaveBeenCalled();
    });
  });

  // ── #15: Stranger → getEffectiveRole is null, updateChannel denied ────────────

  describe('#15 stranger gets null effective role', () => {
    it('getEffectiveRole returns null for stranger with no memberships and no bots', async () => {
      botServiceMock.findActiveBotsByMentorId.mockResolvedValueOnce([]); // no mentored bots

      // DB returns no rows for the stranger
      db.where.mockResolvedValueOnce([] as any);

      const role = await service.getEffectiveRole(
        CHANNEL_ID,
        'stranger-1',
        TENANT_ID,
      );

      expect(role).toBeNull();
      expect(botServiceMock.findActiveBotsByMentorId).toHaveBeenCalledWith(
        'stranger-1',
        TENANT_ID,
      );
    });

    it('updateChannel throws ForbiddenException for stranger', async () => {
      // Redis returns channel with tenantId
      redisMock.getOrSet.mockResolvedValueOnce(BASE_CHANNEL as any);
      // getEffectiveRole → botService returns no bots, DB returns no rows
      botServiceMock.findActiveBotsByMentorId.mockResolvedValueOnce([]);
      db.where.mockResolvedValueOnce([] as any);

      await expect(
        service.update(CHANNEL_ID, { name: 'hack' } as any, 'stranger-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(db.update).not.toHaveBeenCalled();
    });
  });

  // ── #16: After bot.mentorId=null, derivation returns no new hits ──────────────

  describe('#16 after bot.mentorId=null, derivation returns no new hits', () => {
    it('returns [] from findActiveBotsByMentorId when mentor is unset', async () => {
      // findActiveBotsByMentorId returns [] (mentor unset clears them from results)
      botServiceMock.findActiveBotsByMentorId.mockResolvedValueOnce([]);

      db.where.mockResolvedValueOnce([] as any); // DB query with only userId

      const role = await service.getEffectiveRole(
        CHANNEL_ID,
        USER_ID,
        TENANT_ID,
      );

      expect(role).toBeNull();
      expect(botServiceMock.findActiveBotsByMentorId).toHaveBeenCalledWith(
        USER_ID,
        TENANT_ID,
      );
    });
  });

  // ── #17: After bot.isActive=false, derivation filtered out ───────────────────

  describe('#17 after bot.isActive=false, derivation is filtered out', () => {
    it('returns [] from findActiveBotsByMentorId when bot is inactive', async () => {
      // BotService.findActiveBotsByMentorId already filters isActive=true;
      // inactive bot → not in returned list → not in subjectUserIds
      botServiceMock.findActiveBotsByMentorId.mockResolvedValueOnce([]);

      db.where.mockResolvedValueOnce([] as any);

      const role = await service.getEffectiveRole(
        CHANNEL_ID,
        USER_ID,
        TENANT_ID,
      );

      expect(role).toBeNull();
      // Confirm that findActiveBotsByMentorId is still called (the filter is inside BotService)
      expect(botServiceMock.findActiveBotsByMentorId).toHaveBeenCalledWith(
        USER_ID,
        TENANT_ID,
      );
    });
  });

  // ── #18: isChannelMember returns true for mentor-derived user (§6.2 #2) ──────

  describe('#18 isChannelMember returns true for mentor-derived user (spec §6.2 #2)', () => {
    it('returns true when user mentors the owner bot', async () => {
      // User mentors bot-1, which is an owner of the channel
      botServiceMock.findActiveBotsByMentorId.mockResolvedValueOnce([
        { botUserId: BOT_USER_ID },
      ]);
      db.where.mockResolvedValueOnce([
        { channelId: CHANNEL_ID, userId: BOT_USER_ID, role: 'owner' },
      ] as any);

      const result = await service.isChannelMember(
        CHANNEL_ID,
        USER_ID,
        TENANT_ID,
      );

      expect(result).toBe(true);
    });

    it('returns false for a stranger with no mentored bots (sabotage test)', async () => {
      // Without the derivation call, this would be unreachable — but sabotage confirms
      // that removing the getEffectiveRole delegation breaks the true case above.
      botServiceMock.findActiveBotsByMentorId.mockResolvedValueOnce([]);
      db.where.mockResolvedValueOnce([] as any);

      const result = await service.isChannelMember(
        CHANNEL_ID,
        'stranger-2',
        TENANT_ID,
      );

      expect(result).toBe(false);
    });
  });

  // ── #19: assertReadAccess does NOT throw for mentor-derived user (§6.2 #2) ───

  describe('#19 assertReadAccess passes for mentor-derived user (spec §6.2 #2)', () => {
    it('does not throw when user mentors the channel owner bot', async () => {
      // assertReadAccess calls findById first (via redis.getOrSet), then isChannelMember
      redisMock.getOrSet.mockResolvedValueOnce({
        ...BASE_CHANNEL,
        type: 'private', // private channel — would normally require direct membership
      } as any);

      // isChannelMember → getEffectiveRole: user mentors bot that owns the channel
      botServiceMock.findActiveBotsByMentorId.mockResolvedValueOnce([
        { botUserId: BOT_USER_ID },
      ]);
      db.where.mockResolvedValueOnce([
        { channelId: CHANNEL_ID, userId: BOT_USER_ID, role: 'owner' },
      ] as any);

      await expect(
        service.assertReadAccess(CHANNEL_ID, USER_ID),
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenException for a stranger — sabotage test for assertReadAccess', async () => {
      // Private channel, no bots, no direct membership → must throw
      redisMock.getOrSet.mockResolvedValueOnce({
        ...BASE_CHANNEL,
        type: 'private',
      } as any);
      botServiceMock.findActiveBotsByMentorId.mockResolvedValueOnce([]);
      db.where.mockResolvedValueOnce([] as any);

      await expect(
        service.assertReadAccess(CHANNEL_ID, 'stranger-2'),
      ).rejects.toBeInstanceOf(
        (await import('@nestjs/common')).ForbiddenException,
      );
    });
  });
});
