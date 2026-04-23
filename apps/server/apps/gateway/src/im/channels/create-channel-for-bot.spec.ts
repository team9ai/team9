/**
 * Isolated spec for ChannelsService.createChannelForBot.
 *
 * Extracted into its own file so that jest.unstable_mockModule for
 * '@team9/database' (needed to assert on eq/inArray filter args) does
 * not interfere with the large existing channels.service.spec.ts which
 * uses static imports and a different mocking strategy.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as schema from '@team9/database/schemas';

// ── drizzle-orm helper spies ──────────────────────────────────────────
// These must be declared before jest.unstable_mockModule is called so
// the factory closure can capture them.

const mockEq = jest.fn((col: unknown, val: unknown) => ({ __eq: [col, val] }));
const mockAnd = jest.fn((...args: unknown[]) => ({
  __and: args.filter((a) => a !== undefined),
}));
const mockInArray = jest.fn((col: unknown, vals: unknown) => ({
  __inArray: [col, vals],
}));
const mockIsNull = jest.fn((col: unknown) => ({ __isNull: col }));

jest.unstable_mockModule('@team9/database', () => ({
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION_mock'),
  eq: mockEq,
  and: mockAnd,
  inArray: mockInArray,
  isNull: mockIsNull,
  // Pass-through stubs for helpers used elsewhere in ChannelsService but
  // not under test here.
  alias: jest.fn((table: unknown, name: unknown) => ({
    __alias: [table, name],
  })),
  sql: jest.fn() as unknown as typeof import('@team9/database').sql,
  desc: jest.fn((col: unknown) => ({ __desc: col })),
}));

const { ChannelsService, BOT_SERVICE_TOKEN } =
  await import('./channels.service.js');
const { DATABASE_CONNECTION } = await import('@team9/database');

import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from '@team9/redis';
import { ChannelMemberCacheService } from '../shared/channel-member-cache.service.js';
import { TabsService } from '../views/tabs.service.js';

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
  // Default transaction passes the same chain as tx so assertions work
  // inside and outside the transaction without extra setup.
  chain.transaction = jest
    .fn<any>()
    .mockImplementation(async (cb: any) => cb(chain));
  return chain;
}

// ── constants ─────────────────────────────────────────────────────────

const BOT_USER_ID = 'bot-1';
const TENANT_ID = 'tenant-1';
const MENTOR_ID = 'mentor-1';
const CHANNEL_ROW = {
  id: 'chan-1',
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

// ── suite ─────────────────────────────────────────────────────────────

describe('ChannelsService.createChannelForBot', () => {
  let service: InstanceType<typeof ChannelsService>;
  let db: ReturnType<typeof mockDb>;
  let botServiceMock: { getBotMentorId: MockFn };
  let tabsServiceMock: { seedBuiltinTabs: MockFn };

  beforeEach(async () => {
    // Clear drizzle-orm spies between tests so call counts don't bleed
    mockEq.mockClear();
    mockAnd.mockClear();
    mockInArray.mockClear();
    mockIsNull.mockClear();

    db = mockDb();

    botServiceMock = {
      getBotMentorId: jest.fn<any>().mockResolvedValue(null),
    };
    tabsServiceMock = {
      seedBuiltinTabs: jest.fn<any>().mockResolvedValue(undefined),
    };

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
          useValue: tabsServiceMock,
        },
        {
          provide: BOT_SERVICE_TOKEN,
          useValue: botServiceMock,
        },
      ],
    }).compile();

    service = module.get<InstanceType<typeof ChannelsService>>(ChannelsService);
  });

  // ── Error paths ──────────────────────────────────────────────────────

  it('throws NotFoundException when the bot row does not exist', async () => {
    botServiceMock.getBotMentorId.mockResolvedValueOnce(null);

    await expect(
      service.createChannelForBot(BOT_USER_ID, TENANT_ID, {
        name: 'ops',
        type: 'public',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(db.insert).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when the bot is inactive', async () => {
    botServiceMock.getBotMentorId.mockResolvedValueOnce({
      mentorId: null,
      isActive: false,
    });

    await expect(
      service.createChannelForBot(BOT_USER_ID, TENANT_ID, {
        name: 'ops',
        type: 'public',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(db.insert).not.toHaveBeenCalled();
  });

  // ── Happy path: no seed members ──────────────────────────────────────

  it('creates a public channel with bot + mentor as owners, no seed members', async () => {
    botServiceMock.getBotMentorId.mockResolvedValueOnce({
      mentorId: MENTOR_ID,
      isActive: true,
    });
    db.returning.mockResolvedValueOnce([CHANNEL_ROW] as any);
    // tenantMembers query for mentor (no seed ids): mentor is in the tenant
    db.where.mockResolvedValueOnce([{ userId: MENTOR_ID }] as any);

    const addMemberSpy = jest
      .spyOn(service, 'addMember')
      .mockResolvedValue(undefined as any);

    const result = await service.createChannelForBot(BOT_USER_ID, TENANT_ID, {
      name: 'ops',
      type: 'public',
    });

    expect(result).toEqual(CHANNEL_ROW);
    expect(addMemberSpy).toHaveBeenCalledWith(
      'chan-1',
      BOT_USER_ID,
      'owner',
      expect.anything(),
    );
    expect(addMemberSpy).toHaveBeenCalledWith(
      'chan-1',
      MENTOR_ID,
      'owner',
      expect.anything(),
    );
    expect(tabsServiceMock.seedBuiltinTabs).toHaveBeenCalledWith('chan-1');

    // seedBuiltinTabs must run AFTER the transaction commits, not inside it
    const txOrder = db.transaction.mock.invocationCallOrder[0];
    const tabsOrder =
      tabsServiceMock.seedBuiltinTabs.mock.invocationCallOrder[0];
    expect(txOrder).toBeLessThan(tabsOrder);

    addMemberSpy.mockRestore();
  });

  it('creates a channel with only the bot as owner when mentorId is null', async () => {
    botServiceMock.getBotMentorId.mockResolvedValueOnce({
      mentorId: null,
      isActive: true,
    });
    db.returning.mockResolvedValueOnce([CHANNEL_ROW] as any);

    const addMemberSpy = jest
      .spyOn(service, 'addMember')
      .mockResolvedValue(undefined as any);

    await service.createChannelForBot(BOT_USER_ID, TENANT_ID, {
      name: 'ops',
      type: 'public',
    });

    expect(addMemberSpy).toHaveBeenCalledTimes(1);
    expect(addMemberSpy).toHaveBeenCalledWith(
      'chan-1',
      BOT_USER_ID,
      'owner',
      expect.anything(),
    );

    addMemberSpy.mockRestore();
  });

  // ── Filter-structure assertions: cross-tenant rejection ───────────────
  //
  // These three tests exercise the tenantMembers validation branch and assert
  // that eq(schema.tenantMembers.tenantId, tenantId) and
  // inArray(schema.tenantMembers.userId, ...) are both passed to the where()
  // clause. If either filter is removed from channels.service.ts, at least
  // one of these assertions will fail.

  it('throws BadRequestException and asserts tenantId + userId filters when a memberUserId is cross-tenant', async () => {
    botServiceMock.getBotMentorId.mockResolvedValueOnce({
      mentorId: MENTOR_ID,
      isActive: true,
    });
    db.returning.mockResolvedValueOnce([CHANNEL_ROW] as any);

    // Combined query for mentor + seed ids. Mentor and 'u-valid' are present;
    // 'u-cross' is absent (excluded by tenant filter).
    db.where.mockResolvedValueOnce([
      { userId: MENTOR_ID },
      { userId: 'u-valid' },
    ] as any);

    const addMemberSpy = jest
      .spyOn(service, 'addMember')
      .mockResolvedValue(undefined as any);

    await expect(
      service.createChannelForBot(BOT_USER_ID, TENANT_ID, {
        name: 'ops',
        type: 'public',
        memberUserIds: ['u-valid', 'u-cross'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Filter-structure assertions — dropping eq(tenantId) must fail this test
    expect(mockEq).toHaveBeenCalledWith(
      schema.tenantMembers.tenantId,
      TENANT_ID,
    );
    expect(mockInArray).toHaveBeenCalledWith(
      schema.tenantMembers.userId,
      expect.any(Array),
    );
    // Active-membership predicate: tenantMembers.leftAt IS NULL must be
    // included so a user who left the tenant cannot be materialized as a
    // channel member. Dropping this filter fails this test.
    expect(mockIsNull).toHaveBeenCalledWith(schema.tenantMembers.leftAt);

    // addMember for 'member' role must NOT have been called
    const memberCalls = addMemberSpy.mock.calls.filter(
      (c) => c[2] === 'member',
    );
    expect(memberCalls).toHaveLength(0);

    addMemberSpy.mockRestore();
  });

  it('throws BadRequestException and asserts tenantId + userId filters when a memberUserId does not exist', async () => {
    botServiceMock.getBotMentorId.mockResolvedValueOnce({
      mentorId: null,
      isActive: true,
    });
    db.returning.mockResolvedValueOnce([CHANNEL_ROW] as any);

    // tenantMembers query returns empty — 'u-ghost' doesn't exist in tenant
    db.where.mockResolvedValueOnce([] as any);

    const addMemberSpy = jest
      .spyOn(service, 'addMember')
      .mockResolvedValue(undefined as any);

    await expect(
      service.createChannelForBot(BOT_USER_ID, TENANT_ID, {
        name: 'ops',
        type: 'public',
        memberUserIds: ['u-ghost'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Filter-structure assertions — dropping eq(tenantId) must fail this test
    expect(mockEq).toHaveBeenCalledWith(
      schema.tenantMembers.tenantId,
      TENANT_ID,
    );
    expect(mockInArray).toHaveBeenCalledWith(
      schema.tenantMembers.userId,
      expect.any(Array),
    );
    // Active-membership predicate: tenantMembers.leftAt IS NULL must be
    // included so a user who left the tenant cannot be materialized as a
    // channel member. Dropping this filter fails this test.
    expect(mockIsNull).toHaveBeenCalledWith(schema.tenantMembers.leftAt);

    addMemberSpy.mockRestore();
  });

  it('creates a private channel with valid seed members and asserts both filters', async () => {
    botServiceMock.getBotMentorId.mockResolvedValueOnce({
      mentorId: MENTOR_ID,
      isActive: true,
    });
    db.returning.mockResolvedValueOnce([
      { ...CHANNEL_ROW, type: 'private' },
    ] as any);

    // Combined query validates mentor + both seed members in one shot
    db.where.mockResolvedValueOnce([
      { userId: MENTOR_ID },
      { userId: 'u-1' },
      { userId: 'u-2' },
    ] as any);

    const addMemberSpy = jest
      .spyOn(service, 'addMember')
      .mockResolvedValue(undefined as any);

    await service.createChannelForBot(BOT_USER_ID, TENANT_ID, {
      name: 'ops',
      type: 'private',
      memberUserIds: ['u-1', 'u-2'],
    });

    // Filter-structure assertions — dropping eq(tenantId) must fail this test
    expect(mockEq).toHaveBeenCalledWith(
      schema.tenantMembers.tenantId,
      TENANT_ID,
    );
    expect(mockInArray).toHaveBeenCalledWith(
      schema.tenantMembers.userId,
      expect.any(Array),
    );
    // Active-membership predicate: tenantMembers.leftAt IS NULL must be
    // included so a user who left the tenant cannot be materialized as a
    // channel member. Dropping this filter fails this test.
    expect(mockIsNull).toHaveBeenCalledWith(schema.tenantMembers.leftAt);

    // Mentor should have been added as owner
    expect(addMemberSpy).toHaveBeenCalledWith(
      'chan-1',
      MENTOR_ID,
      'owner',
      expect.anything(),
    );
    // Both seed members should have been added
    expect(addMemberSpy).toHaveBeenCalledWith(
      'chan-1',
      'u-1',
      'member',
      expect.anything(),
    );
    expect(addMemberSpy).toHaveBeenCalledWith(
      'chan-1',
      'u-2',
      'member',
      expect.anything(),
    );

    addMemberSpy.mockRestore();
  });

  // ── Mentor cross-tenant guard ─────────────────────────────────────────
  //
  // Security: if mentorId is not in tenantMembers for this tenant, the mentor
  // row must NOT be inserted. The channel must still succeed with bot as owner.
  // Sabotage-verify: removing the existingIds.has(mentorId) guard from
  // channels.service.ts causes this test to fail because addMember would be
  // called with mentorId + 'owner'.

  it('skips mentor owner row when mentorId is not in the bot tenant, but channel still succeeds', async () => {
    const CROSS_TENANT_MENTOR = 'mentor-other-tenant';
    botServiceMock.getBotMentorId.mockResolvedValueOnce({
      mentorId: CROSS_TENANT_MENTOR,
      isActive: true,
    });
    db.returning.mockResolvedValueOnce([CHANNEL_ROW] as any);
    // tenantMembers query returns empty — mentor is NOT in this tenant
    db.where.mockResolvedValueOnce([] as any);

    const addMemberSpy = jest
      .spyOn(service, 'addMember')
      .mockResolvedValue(undefined as any);

    const result = await service.createChannelForBot(BOT_USER_ID, TENANT_ID, {
      name: 'ops',
      type: 'public',
    });

    // Channel should have been created successfully
    expect(result).toEqual(CHANNEL_ROW);

    // Bot is owner
    expect(addMemberSpy).toHaveBeenCalledWith(
      'chan-1',
      BOT_USER_ID,
      'owner',
      expect.anything(),
    );
    // Mentor must NOT have been inserted
    expect(addMemberSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      CROSS_TENANT_MENTOR,
      'owner',
      expect.anything(),
    );
    // addMember called exactly once (bot only)
    expect(addMemberSpy).toHaveBeenCalledTimes(1);

    // Tabs still seeded
    expect(tabsServiceMock.seedBuiltinTabs).toHaveBeenCalledWith('chan-1');

    addMemberSpy.mockRestore();
  });

  // ── seedBuiltinTabs is called AFTER members (call-order test) ─────────

  it('calls seedBuiltinTabs after all members are inserted and outside the transaction', async () => {
    const callOrder: string[] = [];

    botServiceMock.getBotMentorId.mockResolvedValueOnce({
      mentorId: null,
      isActive: true,
    });
    db.returning.mockResolvedValueOnce([CHANNEL_ROW] as any);

    const addMemberSpy = jest
      .spyOn(service, 'addMember')
      .mockImplementation(async () => {
        callOrder.push('addMember');
      });

    tabsServiceMock.seedBuiltinTabs.mockImplementationOnce(async () => {
      callOrder.push('seedBuiltinTabs');
    });

    await service.createChannelForBot(BOT_USER_ID, TENANT_ID, {
      name: 'ops',
      type: 'public',
    });

    expect(callOrder).toEqual(['addMember', 'seedBuiltinTabs']);

    // seedBuiltinTabs must be called AFTER the transaction (not inside it)
    const txOrder = db.transaction.mock.invocationCallOrder[0];
    const tabsOrder =
      tabsServiceMock.seedBuiltinTabs.mock.invocationCallOrder[0];
    expect(txOrder).toBeLessThan(tabsOrder);

    addMemberSpy.mockRestore();
  });

  // ── Other correctness tests ───────────────────────────────────────────

  it('silently drops botUserId and mentorId from memberUserIds before validation', async () => {
    botServiceMock.getBotMentorId.mockResolvedValueOnce({
      mentorId: MENTOR_ID,
      isActive: true,
    });
    db.returning.mockResolvedValueOnce([CHANNEL_ROW] as any);
    // seedIds is empty after filtering; query still runs for mentor alone
    db.where.mockResolvedValueOnce([{ userId: MENTOR_ID }] as any);

    const addMemberSpy = jest
      .spyOn(service, 'addMember')
      .mockResolvedValue(undefined as any);

    await service.createChannelForBot(BOT_USER_ID, TENANT_ID, {
      name: 'ops',
      type: 'public',
      memberUserIds: [BOT_USER_ID, MENTOR_ID],
    });

    // Only bot + mentor as owners, no member calls
    expect(addMemberSpy).toHaveBeenCalledTimes(2);
    expect(addMemberSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      BOT_USER_ID,
      'member',
      expect.anything(),
    );
    expect(addMemberSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      MENTOR_ID,
      'member',
      expect.anything(),
    );
    // Mentor tenancy check uses inArray([mentorId]) — inArray WAS called
    expect(mockInArray).toHaveBeenCalledWith(
      schema.tenantMembers.userId,
      expect.arrayContaining([MENTOR_ID]),
    );

    addMemberSpy.mockRestore();
  });

  it('deduplicates repeated memberUserIds and adds each once', async () => {
    botServiceMock.getBotMentorId.mockResolvedValueOnce({
      mentorId: null,
      isActive: true,
    });
    db.returning.mockResolvedValueOnce([CHANNEL_ROW] as any);

    // tenantMembers validation: 'u-1' is valid
    db.where.mockResolvedValueOnce([{ userId: 'u-1' }] as any);

    const addMemberSpy = jest
      .spyOn(service, 'addMember')
      .mockResolvedValue(undefined as any);

    await service.createChannelForBot(BOT_USER_ID, TENANT_ID, {
      name: 'ops',
      type: 'public',
      memberUserIds: ['u-1', 'u-1', 'u-1'],
    });

    // u-1 added exactly once as member
    const memberCalls = addMemberSpy.mock.calls.filter(
      (c) => c[1] === 'u-1' && c[2] === 'member',
    );
    expect(memberCalls).toHaveLength(1);

    addMemberSpy.mockRestore();
  });

  it('includes missing ids in the BadRequestException message', async () => {
    botServiceMock.getBotMentorId.mockResolvedValueOnce({
      mentorId: null,
      isActive: true,
    });
    db.returning.mockResolvedValueOnce([CHANNEL_ROW] as any);

    // Only 'u-a' exists; 'u-b' and 'u-c' are missing
    db.where.mockResolvedValueOnce([{ userId: 'u-a' }] as any);

    const addMemberSpy = jest
      .spyOn(service, 'addMember')
      .mockResolvedValue(undefined as any);

    await expect(
      service.createChannelForBot(BOT_USER_ID, TENANT_ID, {
        name: 'ops',
        type: 'public',
        memberUserIds: ['u-a', 'u-b', 'u-c'],
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('u-b'),
    });

    addMemberSpy.mockRestore();
  });
});
