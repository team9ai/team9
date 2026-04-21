import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';

// ── Module mocks ─────────────────────────────────────────────────────────────

const dbModule = {
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
};

const schemaModule = {
  bots: {
    id: 'bots.id',
    userId: 'bots.user_id',
    mentorId: 'bots.mentor_id',
    extra: 'bots.extra',
    managedMeta: 'bots.managed_meta',
    updatedAt: 'bots.updated_at',
  },
  users: {
    id: 'users.id',
    displayName: 'users.display_name',
  },
};

jest.unstable_mockModule('@team9/database', () => dbModule);
jest.unstable_mockModule('@team9/database/schemas', () => schemaModule);

const { BotStaffProfileService } =
  await import('./bot-staff-profile.service.js');

// ── Drizzle chain mock ──────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

/**
 * Builds a thenable chain query object. Every chain method returns
 * the same query object. Resolving (or awaiting) the query dequeues the
 * next value from the provided result state.
 */
function createQuery(resolve: () => unknown) {
  const query: Record<string, MockFn> & {
    then: (
      onfulfilled: (value: unknown) => unknown,
      onrejected?: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  } = {
    from: jest.fn<any>(),
    innerJoin: jest.fn<any>(),
    leftJoin: jest.fn<any>(),
    where: jest.fn<any>(),
    orderBy: jest.fn<any>(),
    limit: jest.fn<any>(),
    values: jest.fn<any>(),
    returning: jest.fn<any>(),
    set: jest.fn<any>(),
    then(onfulfilled, onrejected) {
      return Promise.resolve(resolve()).then(onfulfilled, onrejected);
    },
  };

  for (const key of [
    'from',
    'innerJoin',
    'leftJoin',
    'where',
    'orderBy',
    'limit',
    'values',
    'returning',
    'set',
  ] as const) {
    query[key].mockReturnValue(query as never);
  }

  return query;
}

function mockDb() {
  const state = {
    selectResults: [] as unknown[][],
    updateResults: [] as unknown[][],
  };

  const db = {
    __state: state,
    __queries: {
      select: [] as ReturnType<typeof createQuery>[],
      update: [] as ReturnType<typeof createQuery>[],
    },
    select: jest.fn((...args: unknown[]) => {
      const query = createQuery(() =>
        state.selectResults.length > 0 ? state.selectResults.shift() : [],
      );
      (query as any).args = args;
      db.__queries.select.push(query);
      return query as never;
    }),
    update: jest.fn((...args: unknown[]) => {
      const query = createQuery(() =>
        state.updateResults.length > 0 ? state.updateResults.shift() : [],
      );
      (query as any).args = args;
      db.__queries.update.push(query);
      return query as never;
    }),
    // transaction: passes the db itself as the tx argument to the callback
    transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb(db);
    }),
  };

  return db;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const BOT_USER_ID = 'bot-user-uuid-1';
const MENTOR_ID = 'mentor-uuid-1';
const AGENT_ID = 'common-staff-abc';
const FIXED_DATE = new Date('2026-04-21T00:00:00.000Z');

type BotRow = {
  botUserId: string;
  mentorId: string | null;
  extra: Record<string, unknown> | null;
  managedMeta: Record<string, unknown> | null;
  displayName: string | null;
  updatedAt: Date;
};

function makeRow(overrides: Partial<BotRow> = {}): BotRow {
  return {
    botUserId: BOT_USER_ID,
    mentorId: MENTOR_ID,
    extra: null,
    managedMeta: { agentId: AGENT_ID },
    displayName: 'Display',
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('BotStaffProfileService', () => {
  let service: InstanceType<typeof BotStaffProfileService>;
  let db: ReturnType<typeof mockDb>;

  beforeEach(() => {
    db = mockDb();
    service = new BotStaffProfileService(db as any);
    jest.clearAllMocks();
  });

  // ==================== getSnapshot ====================

  describe('getSnapshot', () => {
    it('returns full snapshot for common-staff bot with all extra fields populated', async () => {
      db.__state.selectResults.push([
        makeRow({
          extra: {
            commonStaff: {
              roleTitle: 'Lead Qualifier',
              persona: 'Sharp and direct.',
              jobDescription: 'Qualifies inbound leads.',
              identity: { name: 'Morgan', favoriteColor: 'red' },
            },
          },
        }),
      ]);

      const snap = await service.getSnapshot(BOT_USER_ID);

      expect(snap).toEqual({
        agentId: AGENT_ID,
        botUserId: BOT_USER_ID,
        mentorUserId: MENTOR_ID,
        identity: { name: 'Morgan', favoriteColor: 'red' },
        role: {
          title: 'Lead Qualifier',
          description: 'Qualifies inbound leads.',
        },
        persona: { markdown: 'Sharp and direct.' },
        updatedAt: '2026-04-21T00:00:00.000Z',
      });
    });

    it('returns snapshot for personal-staff bot with system-fixed role', async () => {
      db.__state.selectResults.push([
        makeRow({
          extra: {
            personalStaff: {
              persona: 'Friendly.',
              identity: { name: 'Aria' },
            },
          },
          managedMeta: { agentId: 'personal-staff-xyz' },
          displayName: 'Aria',
        }),
      ]);

      const snap = await service.getSnapshot(BOT_USER_ID);

      expect(snap.role).toEqual({
        title: 'Personal Assistant',
        description: 'Dedicated personal assistant for your owner',
      });
      expect(snap.persona).toEqual({ markdown: 'Friendly.' });
      expect(snap.identity).toEqual({ name: 'Aria' });
      expect(snap.agentId).toBe('personal-staff-xyz');
    });

    it('uses extra.commonStaff when both commonStaff and personalStaff are set (common precedence)', async () => {
      db.__state.selectResults.push([
        makeRow({
          extra: {
            commonStaff: { roleTitle: 'Common-Role' },
            personalStaff: { persona: 'P' },
          },
        }),
      ]);

      const snap = await service.getSnapshot(BOT_USER_ID);
      expect(snap.role?.title).toBe('Common-Role');
      expect(snap.persona).toBeUndefined();
    });

    it('returns empty identity {} when extra.commonStaff exists but identity unset', async () => {
      db.__state.selectResults.push([
        makeRow({ extra: { commonStaff: { roleTitle: 'X' } } }),
      ]);

      const snap = await service.getSnapshot(BOT_USER_ID);
      expect(snap.identity).toEqual({});
    });

    it('returns empty identity {} when extra.personalStaff exists but identity unset', async () => {
      db.__state.selectResults.push([
        makeRow({ extra: { personalStaff: {} } }),
      ]);

      const snap = await service.getSnapshot(BOT_USER_ID);
      expect(snap.identity).toEqual({});
    });

    it('returns empty string for agentId when managed_meta missing or no agentId key', async () => {
      db.__state.selectResults.push([
        makeRow({ extra: { commonStaff: {} }, managedMeta: null }),
      ]);
      const snap1 = await service.getSnapshot(BOT_USER_ID);
      expect(snap1.agentId).toBe('');

      db.__state.selectResults.push([
        makeRow({ extra: { commonStaff: {} }, managedMeta: {} }),
      ]);
      const snap2 = await service.getSnapshot(BOT_USER_ID);
      expect(snap2.agentId).toBe('');
    });

    it('returns undefined mentorUserId when mentor_id is null', async () => {
      db.__state.selectResults.push([
        makeRow({ extra: { commonStaff: {} }, mentorId: null }),
      ]);
      const snap = await service.getSnapshot(BOT_USER_ID);
      expect(snap.mentorUserId).toBeUndefined();
    });

    it('returns undefined persona when extra.commonStaff.persona unset', async () => {
      db.__state.selectResults.push([
        makeRow({ extra: { commonStaff: { roleTitle: 'X' } } }),
      ]);
      const snap = await service.getSnapshot(BOT_USER_ID);
      expect(snap.persona).toBeUndefined();
    });

    it('throws NotFoundException when no bot row exists for botUserId', async () => {
      db.__state.selectResults.push([]);
      await expect(service.getSnapshot('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when bot has neither commonStaff nor personalStaff in extra', async () => {
      db.__state.selectResults.push([
        makeRow({ extra: { openclaw: { agentId: 'X' } } }),
      ]);
      await expect(service.getSnapshot(BOT_USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when extra is null', async () => {
      db.__state.selectResults.push([makeRow({ extra: null })]);
      await expect(service.getSnapshot(BOT_USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ==================== updateSnapshot ====================

  describe('updateSnapshot', () => {
    it('merges identityPatch shallowly and preserves existing identity keys', async () => {
      // initial load
      db.__state.selectResults.push([
        makeRow({
          extra: {
            commonStaff: { identity: { name: 'old', color: 'red' } },
          },
        }),
      ]);
      // getSnapshot() re-read after transaction
      db.__state.selectResults.push([
        makeRow({
          extra: {
            commonStaff: { identity: { name: 'new', color: 'red' } },
          },
        }),
      ]);

      const snap = await service.updateSnapshot(BOT_USER_ID, {
        identityPatch: { name: 'new' },
      });

      expect(snap.identity).toEqual({ name: 'new', color: 'red' });
      const setCall = db.__queries.update[0].set.mock.calls[0][0];
      expect(setCall.extra.commonStaff.identity).toEqual({
        name: 'new',
        color: 'red',
      });
    });

    it('deletes identity key when patch value is null', async () => {
      db.__state.selectResults.push([
        makeRow({
          extra: {
            commonStaff: { identity: { name: 'old', color: 'red' } },
          },
        }),
      ]);
      db.__state.selectResults.push([
        makeRow({
          extra: {
            commonStaff: { identity: { name: 'old' } },
          },
        }),
      ]);

      await service.updateSnapshot(BOT_USER_ID, {
        identityPatch: { color: null },
      });

      const setCall = db.__queries.update[0].set.mock.calls[0][0];
      expect(setCall.extra.commonStaff.identity).toEqual({ name: 'old' });
      expect('color' in setCall.extra.commonStaff.identity).toBe(false);
    });

    it('syncs display_name when identityPatch.name is a non-empty string (single transaction, both writes)', async () => {
      db.__state.selectResults.push([
        makeRow({ extra: { commonStaff: { identity: {} } } }),
      ]);
      db.__state.selectResults.push([
        makeRow({ extra: { commonStaff: { identity: { name: 'Alice' } } } }),
      ]);

      await service.updateSnapshot(BOT_USER_ID, {
        identityPatch: { name: 'Alice' },
      });

      expect(db.transaction).toHaveBeenCalledTimes(1);
      // Two update calls: first for bots, second for users
      expect(db.__queries.update).toHaveLength(2);
      // First update targets bots and sets extra + updatedAt
      const botsSet = db.__queries.update[0].set.mock.calls[0][0];
      expect(botsSet.extra.commonStaff.identity).toEqual({ name: 'Alice' });
      expect(botsSet.updatedAt).toBeInstanceOf(Date);
      // Second update targets users and sets displayName
      const usersSet = db.__queries.update[1].set.mock.calls[0][0];
      expect(usersSet.displayName).toBe('Alice');
    });

    it('clears display_name to null when identityPatch.name is an empty string', async () => {
      db.__state.selectResults.push([
        makeRow({
          extra: {
            commonStaff: { identity: { name: 'Old' } },
          },
        }),
      ]);
      db.__state.selectResults.push([
        makeRow({
          extra: { commonStaff: { identity: { name: '' } } },
        }),
      ]);

      await service.updateSnapshot(BOT_USER_ID, {
        identityPatch: { name: '' },
      });

      expect(db.__queries.update).toHaveLength(2);
      const usersSet = db.__queries.update[1].set.mock.calls[0][0];
      expect(usersSet.displayName).toBeNull();
    });

    it('clears display_name to null when identityPatch.name is explicitly null', async () => {
      db.__state.selectResults.push([
        makeRow({
          extra: {
            commonStaff: { identity: { name: 'Old' } },
          },
        }),
      ]);
      db.__state.selectResults.push([
        makeRow({
          extra: { commonStaff: { identity: {} } },
        }),
      ]);

      await service.updateSnapshot(BOT_USER_ID, {
        identityPatch: { name: null },
      });

      expect(db.__queries.update).toHaveLength(2);
      const usersSet = db.__queries.update[1].set.mock.calls[0][0];
      expect(usersSet.displayName).toBeNull();
      // Name key should be deleted from identity
      const botsSet = db.__queries.update[0].set.mock.calls[0][0];
      expect('name' in botsSet.extra.commonStaff.identity).toBe(false);
    });

    it('does not touch users when identityPatch has no name key', async () => {
      db.__state.selectResults.push([
        makeRow({ extra: { commonStaff: { identity: {} } } }),
      ]);
      db.__state.selectResults.push([
        makeRow({
          extra: { commonStaff: { identity: { color: 'blue' } } },
        }),
      ]);

      await service.updateSnapshot(BOT_USER_ID, {
        identityPatch: { color: 'blue' },
      });

      // Only bots updated — no users update
      expect(db.__queries.update).toHaveLength(1);
      expect(db.__queries.update[0].args[0]).toBe(schemaModule.bots);
    });

    it('writes role.title to extra.commonStaff.roleTitle on common-staff', async () => {
      db.__state.selectResults.push([makeRow({ extra: { commonStaff: {} } })]);
      db.__state.selectResults.push([
        makeRow({
          extra: { commonStaff: { roleTitle: 'Engineer' } },
        }),
      ]);

      const snap = await service.updateSnapshot(BOT_USER_ID, {
        role: { title: 'Engineer' },
      });

      const botsSet = db.__queries.update[0].set.mock.calls[0][0];
      expect(botsSet.extra.commonStaff.roleTitle).toBe('Engineer');
      expect(snap.role?.title).toBe('Engineer');
    });

    it('writes role.description to extra.commonStaff.jobDescription on common-staff', async () => {
      db.__state.selectResults.push([
        makeRow({ extra: { commonStaff: { roleTitle: 'Eng' } } }),
      ]);
      db.__state.selectResults.push([
        makeRow({
          extra: {
            commonStaff: { roleTitle: 'Eng', jobDescription: 'Ships code' },
          },
        }),
      ]);

      await service.updateSnapshot(BOT_USER_ID, {
        role: { title: 'Eng', description: 'Ships code' },
      });

      const botsSet = db.__queries.update[0].set.mock.calls[0][0];
      expect(botsSet.extra.commonStaff.jobDescription).toBe('Ships code');
    });

    it('persona append concatenates with \\n\\n separator', async () => {
      db.__state.selectResults.push([
        makeRow({ extra: { commonStaff: { persona: 'A' } } }),
      ]);
      db.__state.selectResults.push([
        makeRow({ extra: { commonStaff: { persona: 'A\n\nB' } } }),
      ]);

      const snap = await service.updateSnapshot(BOT_USER_ID, {
        persona: { mode: 'append', content: 'B' },
      });

      const botsSet = db.__queries.update[0].set.mock.calls[0][0];
      expect(botsSet.extra.commonStaff.persona).toBe('A\n\nB');
      expect(snap.persona?.markdown).toBe('A\n\nB');
    });

    it('persona append without existing sets fresh value (no leading separator)', async () => {
      db.__state.selectResults.push([makeRow({ extra: { commonStaff: {} } })]);
      db.__state.selectResults.push([
        makeRow({ extra: { commonStaff: { persona: 'Hello' } } }),
      ]);

      const snap = await service.updateSnapshot(BOT_USER_ID, {
        persona: { mode: 'append', content: 'Hello' },
      });

      const botsSet = db.__queries.update[0].set.mock.calls[0][0];
      expect(botsSet.extra.commonStaff.persona).toBe('Hello');
      expect(snap.persona?.markdown).toBe('Hello');
    });

    it('persona replace overwrites existing content', async () => {
      db.__state.selectResults.push([
        makeRow({ extra: { commonStaff: { persona: 'Old' } } }),
      ]);
      db.__state.selectResults.push([
        makeRow({ extra: { commonStaff: { persona: 'Fresh' } } }),
      ]);

      await service.updateSnapshot(BOT_USER_ID, {
        persona: { mode: 'replace', content: 'Fresh' },
      });

      const botsSet = db.__queries.update[0].set.mock.calls[0][0];
      expect(botsSet.extra.commonStaff.persona).toBe('Fresh');
    });

    it('persona replace overwrites even when existing content absent', async () => {
      db.__state.selectResults.push([makeRow({ extra: { commonStaff: {} } })]);
      db.__state.selectResults.push([
        makeRow({ extra: { commonStaff: { persona: 'New' } } }),
      ]);

      await service.updateSnapshot(BOT_USER_ID, {
        persona: { mode: 'replace', content: 'New' },
      });

      const botsSet = db.__queries.update[0].set.mock.calls[0][0];
      expect(botsSet.extra.commonStaff.persona).toBe('New');
    });

    it('rejects role on personal-staff with BadRequestException', async () => {
      // Two calls → two initial-load select results
      db.__state.selectResults.push([
        makeRow({ extra: { personalStaff: {} } }),
      ]);
      db.__state.selectResults.push([
        makeRow({ extra: { personalStaff: {} } }),
      ]);

      await expect(
        service.updateSnapshot(BOT_USER_ID, {
          role: { title: 'Nope' },
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateSnapshot(BOT_USER_ID, {
          role: { title: 'Nope' },
        }),
      ).rejects.toThrow('role is not editable for personal staff');
    });

    it('rejects role.description on personal-staff (role-only with description passes DTO but still rejected at service)', async () => {
      db.__state.selectResults.push([
        makeRow({ extra: { personalStaff: {} } }),
      ]);

      // Even when role has only a description (via `as any` since DTO requires title),
      // the service layer must still reject any `role` on personal kind.
      await expect(
        service.updateSnapshot(BOT_USER_ID, {
          role: { description: 'x' } as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts identityPatch-only on personal-staff', async () => {
      db.__state.selectResults.push([
        makeRow({ extra: { personalStaff: { identity: {} } } }),
      ]);
      db.__state.selectResults.push([
        makeRow({
          extra: { personalStaff: { identity: { name: 'Aria' } } },
        }),
      ]);

      const snap = await service.updateSnapshot(BOT_USER_ID, {
        identityPatch: { name: 'Aria' },
      });

      const botsSet = db.__queries.update[0].set.mock.calls[0][0];
      expect(botsSet.extra.personalStaff.identity).toEqual({ name: 'Aria' });
      expect(snap.identity).toEqual({ name: 'Aria' });
      // Personal keeps the system-fixed role regardless
      expect(snap.role?.title).toBe('Personal Assistant');
    });

    it('accepts persona-only on personal-staff', async () => {
      db.__state.selectResults.push([
        makeRow({ extra: { personalStaff: { persona: 'P1' } } }),
      ]);
      db.__state.selectResults.push([
        makeRow({
          extra: { personalStaff: { persona: 'P1\n\nP2' } },
        }),
      ]);

      const snap = await service.updateSnapshot(BOT_USER_ID, {
        persona: { mode: 'append', content: 'P2' },
      });

      const botsSet = db.__queries.update[0].set.mock.calls[0][0];
      expect(botsSet.extra.personalStaff.persona).toBe('P1\n\nP2');
      expect(snap.persona?.markdown).toBe('P1\n\nP2');
    });

    it('bumps updated_at on every successful write', async () => {
      db.__state.selectResults.push([makeRow({ extra: { commonStaff: {} } })]);
      db.__state.selectResults.push([makeRow({ extra: { commonStaff: {} } })]);

      const before = Date.now();
      await service.updateSnapshot(BOT_USER_ID, {
        persona: { mode: 'replace', content: 'X' },
      });
      const after = Date.now();

      const botsSet = db.__queries.update[0].set.mock.calls[0][0];
      expect(botsSet.updatedAt).toBeInstanceOf(Date);
      const bumped = (botsSet.updatedAt as Date).getTime();
      expect(bumped).toBeGreaterThanOrEqual(before);
      expect(bumped).toBeLessThanOrEqual(after);
    });

    it('wraps bots + users writes in single db.transaction() call', async () => {
      db.__state.selectResults.push([
        makeRow({ extra: { commonStaff: { identity: {} } } }),
      ]);
      db.__state.selectResults.push([
        makeRow({
          extra: { commonStaff: { identity: { name: 'Bob' } } },
        }),
      ]);

      await service.updateSnapshot(BOT_USER_ID, {
        identityPatch: { name: 'Bob' },
      });

      expect(db.transaction).toHaveBeenCalledTimes(1);
      // Verify both updates were issued inside the single transaction call
      expect(db.__queries.update).toHaveLength(2);
    });

    it('calls getSnapshot again to return the post-update snapshot (not computed optimistically)', async () => {
      // First load — pre-update state
      db.__state.selectResults.push([
        makeRow({ extra: { commonStaff: { roleTitle: 'Old' } } }),
      ]);
      // Second load — post-update re-read. Simulate: the returned snapshot
      // reflects data we store in the second select result, NOT anything
      // the service could compute locally.
      db.__state.selectResults.push([
        makeRow({
          extra: {
            commonStaff: { roleTitle: 'FRESH-FROM-DB', jobDescription: 'x' },
          },
        }),
      ]);

      const snap = await service.updateSnapshot(BOT_USER_ID, {
        role: { title: 'Engineer' },
      });

      // If the service returned an optimistic snapshot it would have
      // role.title === 'Engineer'; instead it re-reads and returns what the
      // DB now says — proving the re-read path.
      expect(snap.role?.title).toBe('FRESH-FROM-DB');
      expect(snap.role?.description).toBe('x');
      // Two select calls: initial load + post-update getSnapshot
      expect(db.__queries.select).toHaveLength(2);
    });

    it('throws NotFoundException if the bot disappears between loadBotRow and updates', async () => {
      db.__state.selectResults.push([]);
      await expect(
        service.updateSnapshot(BOT_USER_ID, {
          persona: { mode: 'replace', content: 'x' },
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('accepts an empty patch (no-op shaped call) and still returns a fresh snapshot', async () => {
      // initial load
      db.__state.selectResults.push([
        makeRow({ extra: { commonStaff: { roleTitle: 'X' } } }),
      ]);
      // post-update re-read
      db.__state.selectResults.push([
        makeRow({ extra: { commonStaff: { roleTitle: 'X' } } }),
      ]);

      const snap = await service.updateSnapshot(BOT_USER_ID, {});

      // Bots still updated (with existing extra + bumped updatedAt) but
      // no users update.
      expect(db.__queries.update).toHaveLength(1);
      expect(snap.role?.title).toBe('X');
    });
  });
});
