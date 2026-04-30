import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ── Module mocks ─────────────────────────────────────────────────────────────

const dbModule = {
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
};

const schemaModule = {
  bots: {
    userId: 'bots.user_id',
    isActive: 'bots.is_active',
    managedMeta: 'bots.managed_meta',
  },
};

jest.unstable_mockModule('@team9/database', () => dbModule);
jest.unstable_mockModule('@team9/database/schemas', () => schemaModule);

const { BotAgentOwnership } = await import('./bot-agent-ownership.service.js');

import { ForbiddenException } from '@nestjs/common';

// ── Drizzle-chain test double ────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

function createQuery(resolve: () => unknown) {
  const query: Record<string, MockFn> & {
    then: (
      onfulfilled: (value: unknown) => unknown,
      onrejected?: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  } = {
    from: jest.fn<any>(),
    where: jest.fn<any>(),
    limit: jest.fn<any>(),
    then(onfulfilled, onrejected) {
      return Promise.resolve(resolve()).then(onfulfilled, onrejected);
    },
  };
  for (const key of ['from', 'where', 'limit'] as const) {
    query[key].mockReturnValue(query as never);
  }
  return query;
}

function mockDb() {
  const state = {
    selectResults: [] as unknown[][],
  };
  const db = {
    __state: state,
    select: jest.fn(() => {
      const q = createQuery(() =>
        state.selectResults.length > 0 ? state.selectResults.shift() : [],
      );
      return q as never;
    }),
  };
  return db;
}

// ── Fixtures + harness ──────────────────────────────────────────────────────

const BOT_USER_ID = 'bot-user-1';
const AGENT_ID = 'agent-1';

describe('BotAgentOwnership', () => {
  let service: InstanceType<typeof BotAgentOwnership>;
  let db: ReturnType<typeof mockDb>;

  beforeEach(() => {
    db = mockDb();
    service = new BotAgentOwnership(db as never);
  });

  describe('assertAgentBelongsToBot', () => {
    it('resolves when active bot has matching managedMeta.agentId', async () => {
      db.__state.selectResults.push([
        { userId: BOT_USER_ID, managedMeta: { agentId: AGENT_ID } },
      ]);
      await expect(
        service.assertAgentBelongsToBot(BOT_USER_ID, AGENT_ID),
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenException when no bot row exists', async () => {
      db.__state.selectResults.push([]);
      await expect(
        service.assertAgentBelongsToBot(BOT_USER_ID, AGENT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ForbiddenException when managedMeta is null', async () => {
      db.__state.selectResults.push([
        { userId: BOT_USER_ID, managedMeta: null },
      ]);
      await expect(
        service.assertAgentBelongsToBot(BOT_USER_ID, AGENT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ForbiddenException when managedMeta has no agentId', async () => {
      db.__state.selectResults.push([{ userId: BOT_USER_ID, managedMeta: {} }]);
      await expect(
        service.assertAgentBelongsToBot(BOT_USER_ID, AGENT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ForbiddenException when managedMeta.agentId is non-string', async () => {
      db.__state.selectResults.push([
        { userId: BOT_USER_ID, managedMeta: { agentId: 12345 } },
      ]);
      await expect(
        service.assertAgentBelongsToBot(BOT_USER_ID, AGENT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ForbiddenException when managedMeta.agentId mismatches', async () => {
      db.__state.selectResults.push([
        {
          userId: BOT_USER_ID,
          managedMeta: { agentId: 'different-agent' },
        },
      ]);
      await expect(
        service.assertAgentBelongsToBot(BOT_USER_ID, AGENT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('uses the same generic message for all mismatch flavors', async () => {
      db.__state.selectResults.push([]);
      await expect(
        service.assertAgentBelongsToBot(BOT_USER_ID, AGENT_ID),
      ).rejects.toMatchObject({
        message: 'agentId does not belong to caller bot',
      });

      db.__state.selectResults.push([
        { userId: BOT_USER_ID, managedMeta: { agentId: 'other' } },
      ]);
      await expect(
        service.assertAgentBelongsToBot(BOT_USER_ID, AGENT_ID),
      ).rejects.toMatchObject({
        message: 'agentId does not belong to caller bot',
      });
    });
  });
});
