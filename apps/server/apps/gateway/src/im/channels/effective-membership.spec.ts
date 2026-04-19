import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// ── drizzle-orm helper spies ──────────────────────────────────────────────────
// jest.unstable_mockModule must be called before any dynamic import of the
// module being mocked.

const mockEq = jest.fn((col: unknown, val: unknown) => ({ __eq: [col, val] }));
const mockAnd = jest.fn((...args: unknown[]) => ({ __and: args }));
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
}));

// Import the schema separately so tests can pass schema columns to assertion
// helpers. The real schema is loaded after mocking @team9/database so Drizzle
// column references are available.
const schema = await import('@team9/database/schemas');

const { maxRole, resolveEffectiveMembership } =
  await import('./effective-membership.js');

// ── helpers ───────────────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

/** Build a minimal Drizzle-like chainable mock that resolves on .where() */
function mockChain(resolveValue: unknown[] = []) {
  const chain: Record<string, MockFn> = {};
  const methods = ['select', 'from', 'innerJoin'];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  // .where() is the last step in resolveEffectiveMembership — resolve here
  chain.where = jest.fn<any>().mockResolvedValue(resolveValue);
  return chain;
}

/** Build a db mock where a single query returns the given membership rows. */
function makeDb(
  rows: {
    channelId: string;
    userId: string;
    role: 'owner' | 'admin' | 'member';
  }[],
) {
  return mockChain(rows);
}

/** Build a botService mock. */
function makeBotService(mentoredBots: { botUserId: string }[]) {
  return {
    findActiveBotsByMentorId: jest.fn<any>().mockResolvedValue(mentoredBots),
  };
}

// ── maxRole ───────────────────────────────────────────────────────────────────

describe('maxRole', () => {
  it('owner beats admin', () => {
    expect(maxRole('owner', 'admin')).toBe('owner');
    expect(maxRole('admin', 'owner')).toBe('owner');
  });

  it('admin beats member', () => {
    expect(maxRole('admin', 'member')).toBe('admin');
    expect(maxRole('member', 'admin')).toBe('admin');
  });

  it('propagates null when first arg is null', () => {
    expect(maxRole(null, 'member')).toBe('member');
  });

  it('propagates null when second arg is null', () => {
    expect(maxRole('admin', null)).toBe('admin');
  });

  it('returns null when both args are null', () => {
    expect(maxRole(null, null)).toBeNull();
  });
});

// ── resolveEffectiveMembership with channelId ─────────────────────────────────

describe('resolveEffectiveMembership with channelId', () => {
  beforeEach(() => {
    mockEq.mockClear();
    mockAnd.mockClear();
    mockInArray.mockClear();
    mockIsNull.mockClear();
  });

  it('returns null for a stranger (no direct membership, no mentored bots)', async () => {
    const db = makeDb([]);
    const botService = makeBotService([]);

    const role = await resolveEffectiveMembership({
      db: db as never,
      botService,
      userId: 'u-x',
      tenantId: 'tenant-1',
      channelId: 'c-1',
    });

    expect(role).toBeNull();
    expect(botService.findActiveBotsByMentorId).toHaveBeenCalledWith(
      'u-x',
      'tenant-1',
    );
    // Must filter by tenant and leftAt
    expect(mockEq).toHaveBeenCalledWith(schema.channels.tenantId, 'tenant-1');
    expect(mockIsNull).toHaveBeenCalledWith(schema.channelMembers.leftAt);
  });

  it('returns direct role when user is a direct admin member', async () => {
    const db = makeDb([{ channelId: 'c-1', userId: 'u-1', role: 'admin' }]);
    const botService = makeBotService([]);

    const role = await resolveEffectiveMembership({
      db: db as never,
      botService,
      userId: 'u-1',
      tenantId: 'tenant-1',
      channelId: 'c-1',
    });

    expect(role).toBe('admin');
  });

  it('returns bot role when user mentors an active bot that owns the channel', async () => {
    // The bot (bot-1) is owner; user is not a direct member
    const db = makeDb([{ channelId: 'c-1', userId: 'bot-1', role: 'owner' }]);
    const botService = makeBotService([{ botUserId: 'bot-1' }]);

    const role = await resolveEffectiveMembership({
      db: db as never,
      botService,
      userId: 'u-mentor',
      tenantId: 'tenant-1',
      channelId: 'c-1',
    });

    expect(role).toBe('owner');
    // inArray must include both userId and mentored bot ids
    expect(mockInArray).toHaveBeenCalledWith(
      schema.channelMembers.userId,
      expect.arrayContaining(['u-mentor', 'bot-1']),
    );
  });

  it('returns MAX(direct, mentor-derived) — member+owner → owner', async () => {
    // User is direct member AND mentors bot-1 which is owner
    const db = makeDb([
      { channelId: 'c-1', userId: 'u-1', role: 'member' },
      { channelId: 'c-1', userId: 'bot-1', role: 'owner' },
    ]);
    const botService = makeBotService([{ botUserId: 'bot-1' }]);

    const role = await resolveEffectiveMembership({
      db: db as never,
      botService,
      userId: 'u-1',
      tenantId: 'tenant-1',
      channelId: 'c-1',
    });

    expect(role).toBe('owner');
  });

  it('returns null when findActiveBotsByMentorId returns [] and no direct membership', async () => {
    const db = makeDb([]);
    const botService = makeBotService([]); // no mentored bots

    const role = await resolveEffectiveMembership({
      db: db as never,
      botService,
      userId: 'u-1',
      tenantId: 'tenant-1',
      channelId: 'c-1',
    });

    expect(role).toBeNull();
    expect(botService.findActiveBotsByMentorId).toHaveBeenCalledWith(
      'u-1',
      'tenant-1',
    );
  });
});

// ── resolveEffectiveMembership without channelId ──────────────────────────────

describe('resolveEffectiveMembership without channelId', () => {
  beforeEach(() => {
    mockEq.mockClear();
    mockAnd.mockClear();
    mockInArray.mockClear();
    mockIsNull.mockClear();
  });

  it('returns union of visible channels across direct and derived sources', async () => {
    // user is direct member on c-1 (member role)
    // user mentors bot-1 which is owner on c-2
    const db = makeDb([
      { channelId: 'c-1', userId: 'u-1', role: 'member' },
      { channelId: 'c-2', userId: 'bot-1', role: 'owner' },
    ]);
    const botService = makeBotService([{ botUserId: 'bot-1' }]);

    const rows = await resolveEffectiveMembership({
      db: db as never,
      botService,
      userId: 'u-1',
      tenantId: 'tenant-1',
    });

    expect(rows).toEqual(
      expect.arrayContaining([
        { channelId: 'c-1', role: 'member' },
        { channelId: 'c-2', role: 'owner' },
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it('collapses duplicate channelId across sources to the MAX role', async () => {
    // user is direct member on c-1 (member), bot-1 is owner on c-1
    const db = makeDb([
      { channelId: 'c-1', userId: 'u-1', role: 'member' },
      { channelId: 'c-1', userId: 'bot-1', role: 'owner' },
    ]);
    const botService = makeBotService([{ botUserId: 'bot-1' }]);

    const rows = await resolveEffectiveMembership({
      db: db as never,
      botService,
      userId: 'u-1',
      tenantId: 'tenant-1',
    });

    // Only one entry for c-1 with the highest role
    expect(rows).toEqual([{ channelId: 'c-1', role: 'owner' }]);
  });
});
