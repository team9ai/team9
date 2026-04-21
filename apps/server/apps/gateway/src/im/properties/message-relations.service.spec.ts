import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';

// ─── Module mocks (must be before dynamic import) ───────────────────────────

const dbModule = {
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  inArray: jest.fn((col: unknown, vals: unknown[]) => ({
    op: 'inArray',
    col,
    vals,
  })),
  desc: jest.fn((col: unknown) => ({ op: 'desc', col })),
  sql: Object.assign(
    jest.fn(
      (strings: TemplateStringsArray, ..._values: unknown[]) =>
        ({ sql: strings.join('?'), op: 'sql' }) as unknown,
    ),
    {
      join: jest.fn(),
      empty: {},
      raw: jest.fn((s: string) => ({ sql: s, op: 'sql' })),
    },
  ),
};

const schemaModule = {
  messageRelations: {
    sourceMessageId: 'mr.sourceMessageId',
    targetMessageId: 'mr.targetMessageId',
    propertyDefinitionId: 'mr.propertyDefinitionId',
    relationKind: 'mr.relationKind',
    createdAt: 'mr.createdAt',
    tenantId: 'mr.tenantId',
    channelId: 'mr.channelId',
    createdBy: 'mr.createdBy',
  },
  messages: {
    id: 'messages.id',
    channelId: 'messages.channelId',
    tenantId: 'messages.tenantId',
    isDeleted: 'messages.isDeleted',
    parentId: 'messages.parentId',
  },
  messageProperties: {
    messageId: 'mp.messageId',
    propertyDefinitionId: 'mp.propertyDefinitionId',
    jsonValue: 'mp.jsonValue',
  },
};

jest.unstable_mockModule('@team9/database', () => dbModule);
jest.unstable_mockModule('@team9/database/schemas', () => schemaModule);
jest.unstable_mockModule('@team9/shared', () => ({}));

// ─── Dynamic import after mocks are set up ───────────────────────────────────

const { MessageRelationsService } =
  await import('./message-relations.service.js');
const {
  RelationError,
  RelationSourceNotFoundError,
  RelationTargetNotFoundError,
  RELATION_ERROR_CODES,
} = await import('./message-relations.errors.js');

// ─── Fluent-chain mock helpers ────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: unknown[]) => unknown>;

function createQuery(result: unknown) {
  const query: Record<string, MockFn> & {
    then: (resolve: (value: unknown) => unknown, reject?: unknown) => unknown;
  } = {
    from: jest.fn<any>(),
    where: jest.fn<any>(),
    orderBy: jest.fn<any>(),
    limit: jest.fn<any>(),
    values: jest.fn<any>(),
    returning: jest.fn<any>(),
    set: jest.fn<any>(),
    innerJoin: jest.fn<any>(),
    then: (resolve) => Promise.resolve(resolve(result)),
  };

  for (const key of [
    'from',
    'where',
    'orderBy',
    'limit',
    'values',
    'returning',
    'set',
    'innerJoin',
  ] as const) {
    query[key].mockReturnValue(query as never);
  }

  return query;
}

function mockDb() {
  const state = {
    selectResults: [] as unknown[][],
    insertResults: [] as unknown[][],
    deleteResults: [] as unknown[][],
    executeResults: [] as unknown[][],
  };

  const db = {
    __state: state,
    __queries: {
      select: [] as ReturnType<typeof createQuery>[],
      insert: [] as ReturnType<typeof createQuery>[],
      delete: [] as ReturnType<typeof createQuery>[],
    },
    select: jest.fn((...args: unknown[]) => {
      const query = createQuery(state.selectResults.shift());
      (query as any).args = args;
      db.__queries.select.push(query);
      return query as never;
    }),
    insert: jest.fn((...args: unknown[]) => {
      const query = createQuery(state.insertResults.shift());
      (query as any).args = args;
      db.__queries.insert.push(query);
      return query as never;
    }),
    delete: jest.fn((...args: unknown[]) => {
      const query = createQuery(state.deleteResults.shift());
      (query as any).args = args;
      db.__queries.delete.push(query);
      return query as never;
    }),
    execute: jest.fn(async (..._args: unknown[]) => {
      return state.executeResults.shift() ?? [];
    }),
    transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb(db);
    }),
  };

  return db;
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

function sourceRow(overrides: Record<string, unknown> = {}) {
  return {
    channelId: 'channel-1',
    tenantId: 'tenant-1',
    ...overrides,
  };
}

function targetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'target-1',
    channelId: 'channel-1',
    ...overrides,
  };
}

function makeDefinition(
  overrides: Partial<{
    id: string;
    channelId: string;
    config: { scope: string; cardinality: string; relationKind?: string };
  }> = {},
) {
  return {
    id: 'def-1',
    channelId: 'channel-1',
    config: {
      scope: 'any',
      cardinality: 'multi',
      relationKind: 'parent',
    },
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MessageRelationsService', () => {
  let service: InstanceType<typeof MessageRelationsService>;
  let db: ReturnType<typeof mockDb>;

  beforeEach(() => {
    db = mockDb();
    service = new MessageRelationsService(db as any);
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // setRelationTargets
  // ═══════════════════════════════════════════════════════════════════════════

  describe('setRelationTargets', () => {
    it('throws SELF_REFERENCE when target equals source', async () => {
      await expect(
        service.setRelationTargets({
          sourceMessageId: 'msg-1',
          targetMessageIds: ['msg-1'],
          definition: makeDefinition() as any,
          actorId: 'user-1',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.setRelationTargets({
          sourceMessageId: 'msg-1',
          targetMessageIds: ['msg-1'],
          definition: makeDefinition() as any,
          actorId: 'user-1',
        }),
      ).rejects.toMatchObject({
        response: { code: RELATION_ERROR_CODES.SELF_REFERENCE },
      });
    });

    it('throws CARDINALITY_EXCEEDED when single cardinality has >1 target', async () => {
      await expect(
        service.setRelationTargets({
          sourceMessageId: 'msg-src',
          targetMessageIds: ['target-1', 'target-2'],
          definition: makeDefinition({
            config: {
              scope: 'any',
              cardinality: 'single',
              relationKind: 'parent',
            },
          }) as any,
          actorId: 'user-1',
        }),
      ).rejects.toMatchObject({
        response: { code: RELATION_ERROR_CODES.CARDINALITY_EXCEEDED },
      });
    });

    it('throws RelationSourceNotFoundError when source message missing', async () => {
      // source not found
      db.__state.selectResults.push([]);

      await expect(
        service.setRelationTargets({
          sourceMessageId: 'missing-src',
          targetMessageIds: ['target-1'],
          definition: makeDefinition() as any,
          actorId: 'user-1',
        }),
      ).rejects.toThrow(NotFoundException);

      await expect(
        (() => {
          db.__state.selectResults.push([]);
          return service.setRelationTargets({
            sourceMessageId: 'missing-src',
            targetMessageIds: ['target-1'],
            definition: makeDefinition() as any,
            actorId: 'user-1',
          });
        })(),
      ).rejects.toMatchObject({
        response: {
          code: RELATION_ERROR_CODES.TARGET_NOT_FOUND,
          message: expect.stringContaining('Source message missing-src'),
        },
      });
    });

    it('throws RelationTargetNotFoundError when one target missing', async () => {
      // source found
      db.__state.selectResults.push([sourceRow()]);
      // targets: only one returned, but two requested
      db.__state.selectResults.push([targetRow({ id: 'target-1' })]);

      await expect(
        service.setRelationTargets({
          sourceMessageId: 'msg-src',
          targetMessageIds: ['target-1', 'target-missing'],
          definition: makeDefinition() as any,
          actorId: 'user-1',
        }),
      ).rejects.toMatchObject({
        response: { code: RELATION_ERROR_CODES.TARGET_NOT_FOUND },
      });
    });

    it('throws SCOPE_VIOLATION on cross-channel target when scope=same_channel', async () => {
      // source in channel-1
      db.__state.selectResults.push([sourceRow({ channelId: 'channel-1' })]);
      // target in channel-2
      db.__state.selectResults.push([
        targetRow({ id: 'target-1', channelId: 'channel-2' }),
      ]);

      await expect(
        service.setRelationTargets({
          sourceMessageId: 'msg-src',
          targetMessageIds: ['target-1'],
          definition: makeDefinition({
            config: {
              scope: 'same_channel',
              cardinality: 'multi',
              relationKind: 'parent',
            },
          }) as any,
          actorId: 'user-1',
        }),
      ).rejects.toMatchObject({
        response: { code: RELATION_ERROR_CODES.SCOPE_VIOLATION },
      });
    });

    it('allows same-channel target when scope=same_channel', async () => {
      // source in channel-1
      db.__state.selectResults.push([sourceRow({ channelId: 'channel-1' })]);
      // target also in channel-1 (same channel — should pass scope check)
      db.__state.selectResults.push([
        targetRow({ id: 'target-1', channelId: 'channel-1' }),
      ]);
      // existing edges: none
      db.__state.selectResults.push([]);
      // insert
      db.__state.insertResults.push([]);

      const result = await service.setRelationTargets({
        sourceMessageId: 'msg-src',
        targetMessageIds: ['target-1'],
        definition: makeDefinition({
          config: {
            scope: 'same_channel',
            cardinality: 'multi',
            relationKind: 'parent',
          },
        }) as any,
        actorId: 'user-1',
      });

      expect(result.addedTargetIds).toEqual(['target-1']);
    });

    it('allows cross-channel target when scope=any', async () => {
      // source in channel-1
      db.__state.selectResults.push([sourceRow({ channelId: 'channel-1' })]);
      // target in different channel
      db.__state.selectResults.push([
        targetRow({ id: 'target-1', channelId: 'channel-99' }),
      ]);
      // existing edges: none
      db.__state.selectResults.push([]);
      // insert
      db.__state.insertResults.push([]);

      const result = await service.setRelationTargets({
        sourceMessageId: 'msg-src',
        targetMessageIds: ['target-1'],
        definition: makeDefinition({
          config: {
            scope: 'any',
            cardinality: 'multi',
            relationKind: 'parent',
          },
        }) as any,
        actorId: 'user-1',
      });

      expect(result.addedTargetIds).toEqual(['target-1']);
    });

    it('is no-op when desired equals existing (empty toAdd/toRemove)', async () => {
      db.__state.selectResults.push([sourceRow()]);
      db.__state.selectResults.push([targetRow({ id: 'target-1' })]);
      // existing edges contain the same target
      db.__state.selectResults.push([{ targetMessageId: 'target-1' }]);

      const result = await service.setRelationTargets({
        sourceMessageId: 'msg-src',
        targetMessageIds: ['target-1'],
        definition: makeDefinition() as any,
        actorId: 'user-1',
      });

      expect(result.addedTargetIds).toEqual([]);
      expect(result.removedTargetIds).toEqual([]);
      expect(result.currentTargetIds).toEqual(['target-1']);
      expect(db.__queries.insert).toHaveLength(0);
      expect(db.__queries.delete).toHaveLength(0);
    });

    it('inserts only new targets (diff add)', async () => {
      db.__state.selectResults.push([sourceRow()]);
      db.__state.selectResults.push([
        targetRow({ id: 'target-1' }),
        targetRow({ id: 'target-2' }),
      ]);
      // existing: only target-1
      db.__state.selectResults.push([{ targetMessageId: 'target-1' }]);
      // insert
      db.__state.insertResults.push([]);

      const result = await service.setRelationTargets({
        sourceMessageId: 'msg-src',
        targetMessageIds: ['target-1', 'target-2'],
        definition: makeDefinition() as any,
        actorId: 'user-1',
      });

      expect(result.addedTargetIds).toEqual(['target-2']);
      expect(result.removedTargetIds).toEqual([]);
      expect(db.__queries.insert).toHaveLength(1);
      expect(db.__queries.delete).toHaveLength(0);
    });

    it('deletes only missing targets (diff remove)', async () => {
      db.__state.selectResults.push([sourceRow()]);
      // desired is empty, no target validation query
      // existing has target-1
      db.__state.selectResults.push([{ targetMessageId: 'target-1' }]);
      // delete
      db.__state.deleteResults.push([]);

      const result = await service.setRelationTargets({
        sourceMessageId: 'msg-src',
        targetMessageIds: [],
        definition: makeDefinition() as any,
        actorId: 'user-1',
      });

      expect(result.addedTargetIds).toEqual([]);
      expect(result.removedTargetIds).toEqual(['target-1']);
      expect(result.currentTargetIds).toEqual([]);
      expect(db.__queries.delete).toHaveLength(1);
      expect(db.__queries.insert).toHaveLength(0);
    });

    it('replaces both adds + removes in one transaction', async () => {
      db.__state.selectResults.push([sourceRow()]);
      db.__state.selectResults.push([
        targetRow({ id: 'target-2' }),
        targetRow({ id: 'target-3' }),
      ]);
      // existing: target-1 (to remove), target-2 (keep)
      db.__state.selectResults.push([
        { targetMessageId: 'target-1' },
        { targetMessageId: 'target-2' },
      ]);
      // delete target-1
      db.__state.deleteResults.push([]);
      // insert target-3
      db.__state.insertResults.push([]);

      const result = await service.setRelationTargets({
        sourceMessageId: 'msg-src',
        targetMessageIds: ['target-2', 'target-3'],
        definition: makeDefinition() as any,
        actorId: 'user-1',
      });

      expect(result.addedTargetIds).toEqual(['target-3']);
      expect(result.removedTargetIds).toEqual(['target-1']);
      expect(result.currentTargetIds).toEqual(['target-2', 'target-3']);
      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(db.__queries.delete).toHaveLength(1);
      expect(db.__queries.insert).toHaveLength(1);
    });

    it('dedupes duplicate inputs before diff', async () => {
      db.__state.selectResults.push([sourceRow()]);
      // after dedup: ['target-1']
      db.__state.selectResults.push([targetRow({ id: 'target-1' })]);
      // existing: empty
      db.__state.selectResults.push([]);
      // insert
      db.__state.insertResults.push([]);

      const result = await service.setRelationTargets({
        sourceMessageId: 'msg-src',
        targetMessageIds: ['target-1', 'target-1', 'target-1'],
        definition: makeDefinition() as any,
        actorId: 'user-1',
      });

      expect(result.currentTargetIds).toEqual(['target-1']);
      // Only one insert call since we deduplicated
      expect(db.__queries.insert).toHaveLength(1);
    });

    it('throws DEFINITION_CONFLICT when relationKind is undefined and targets are provided', async () => {
      // Must throw before entering the transaction — no DB calls needed
      await expect(
        service.setRelationTargets({
          sourceMessageId: 'msg-src',
          targetMessageIds: ['target-1'],
          definition: makeDefinition({
            config: {
              scope: 'any',
              cardinality: 'multi' /* no relationKind */,
            },
          }) as any,
          actorId: 'user-1',
        }),
      ).rejects.toMatchObject({
        response: { code: RELATION_ERROR_CODES.DEFINITION_CONFLICT },
      });

      // No transaction or DB queries should have been made
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('succeeds when relationKind is undefined but targetMessageIds is empty (deletion no-op)', async () => {
      // source found
      db.__state.selectResults.push([sourceRow()]);
      // existing: has target-1 to remove
      db.__state.selectResults.push([{ targetMessageId: 'target-1' }]);
      // delete
      db.__state.deleteResults.push([]);

      const result = await service.setRelationTargets({
        sourceMessageId: 'msg-src',
        targetMessageIds: [],
        definition: makeDefinition({
          config: { scope: 'any', cardinality: 'multi' /* no relationKind */ },
        }) as any,
        actorId: 'user-1',
      });

      // Deletion still works — no insert needed, no relationKind check triggered
      expect(result.addedTargetIds).toEqual([]);
      expect(result.removedTargetIds).toEqual(['target-1']);
      expect(db.__queries.insert).toHaveLength(0);
      expect(db.__queries.delete).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // setRelationTargets — existingTx variant
  // ═══════════════════════════════════════════════════════════════════════════

  describe('setRelationTargets — existingTx', () => {
    it('when given existingTx, uses it instead of opening a new transaction', async () => {
      const outerDb = mockDb();
      // seed the outerDb (used as outerTx) with the same sequence of results
      outerDb.__state.selectResults.push([sourceRow()]);
      outerDb.__state.selectResults.push([targetRow({ id: 'target-1' })]);
      outerDb.__state.selectResults.push([]); // existing edges
      outerDb.__state.insertResults.push([]); // insert

      const txSpy = jest.spyOn(db, 'transaction');

      await service.setRelationTargets(
        {
          sourceMessageId: 'msg-src',
          targetMessageIds: ['target-1'],
          definition: makeDefinition() as any,
          actorId: 'user-1',
        },
        outerDb as any,
      );

      // Should NOT have opened a new transaction on the service's own db
      expect(txSpy).not.toHaveBeenCalled();
      // Should have used outerDb's insert
      expect(outerDb.__queries.insert).toHaveLength(1);
    });

    it('without existingTx, opens its own transaction as before', async () => {
      db.__state.selectResults.push([sourceRow()]);
      db.__state.selectResults.push([targetRow({ id: 'target-1' })]);
      db.__state.selectResults.push([]);
      db.__state.insertResults.push([]);

      const txSpy = jest.spyOn(db, 'transaction');

      await service.setRelationTargets({
        sourceMessageId: 'msg-src',
        targetMessageIds: ['target-1'],
        definition: makeDefinition() as any,
        actorId: 'user-1',
      });

      expect(txSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getOutgoingTargets
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getOutgoingTargets', () => {
    it('returns target ids ordered by createdAt', async () => {
      db.__state.selectResults.push([
        { targetMessageId: 'target-a' },
        { targetMessageId: 'target-b' },
      ]);

      const result = await service.getOutgoingTargets('src-1', 'def-1');

      expect(result).toEqual(['target-a', 'target-b']);
      // verify orderBy was called
      expect(db.__queries.select[0].orderBy).toHaveBeenCalled();
    });

    it('returns empty array when no edges', async () => {
      db.__state.selectResults.push([]);

      const result = await service.getOutgoingTargets('src-1', 'def-1');

      expect(result).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getOutgoingTargetsForMany
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getOutgoingTargetsForMany', () => {
    it('returns empty map when sourceMessageIds is empty (no DB query)', async () => {
      const result = await service.getOutgoingTargetsForMany([], 'def-1');

      expect(result.size).toBe(0);
      expect(db.__queries.select).toHaveLength(0);
    });

    it('returns map keyed by sourceMessageId with ordered targetIds', async () => {
      db.__state.selectResults.push([
        { sourceMessageId: 'src-1', targetMessageId: 'target-a' },
        { sourceMessageId: 'src-1', targetMessageId: 'target-b' },
        { sourceMessageId: 'src-2', targetMessageId: 'target-c' },
      ]);

      const result = await service.getOutgoingTargetsForMany(
        ['src-1', 'src-2'],
        'def-1',
      );

      expect(result.get('src-1')).toEqual(['target-a', 'target-b']);
      expect(result.get('src-2')).toEqual(['target-c']);
    });

    it('initialises keys for source IDs with no edges (empty arrays)', async () => {
      // src-2 has no edges — DB returns only src-1 rows
      db.__state.selectResults.push([
        { sourceMessageId: 'src-1', targetMessageId: 'target-a' },
      ]);

      const result = await service.getOutgoingTargetsForMany(
        ['src-1', 'src-2'],
        'def-1',
      );

      expect(result.has('src-1')).toBe(true);
      expect(result.get('src-1')).toEqual(['target-a']);
      expect(result.has('src-2')).toBe(true);
      expect(result.get('src-2')).toEqual([]);
    });

    it('preserves createdAt order (orderBy was called)', async () => {
      db.__state.selectResults.push([
        { sourceMessageId: 'src-1', targetMessageId: 'earlier' },
        { sourceMessageId: 'src-1', targetMessageId: 'later' },
      ]);

      const result = await service.getOutgoingTargetsForMany(
        ['src-1'],
        'def-1',
      );

      expect(result.get('src-1')).toEqual(['earlier', 'later']);
      expect(db.__queries.select[0].orderBy).toHaveBeenCalled();
    });

    it('issues exactly one DB query for multiple source IDs', async () => {
      db.__state.selectResults.push([
        { sourceMessageId: 'src-1', targetMessageId: 't1' },
        { sourceMessageId: 'src-2', targetMessageId: 't2' },
        { sourceMessageId: 'src-3', targetMessageId: 't3' },
      ]);

      await service.getOutgoingTargetsForMany(
        ['src-1', 'src-2', 'src-3'],
        'def-1',
      );

      expect(db.__queries.select).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getIncomingSources
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getIncomingSources', () => {
    it('filters by relationKind and returns matching rows', async () => {
      db.__state.selectResults.push([
        { sourceMessageId: 'src-1', propertyDefinitionId: 'def-1' },
      ]);

      const result = await service.getIncomingSources('target-1', 'parent');

      expect(result).toEqual([
        { sourceMessageId: 'src-1', propertyDefinitionId: 'def-1' },
      ]);
    });

    it('excludes deleted source messages via JOIN', async () => {
      // The innerJoin + isDeleted=false filter means deleted messages won't appear.
      // Here we verify the query is built with innerJoin (by checking it was called).
      db.__state.selectResults.push([]);

      await service.getIncomingSources('target-1', 'related');

      expect(db.__queries.select[0].innerJoin).toHaveBeenCalled();
    });

    it('returns source + definition pairs', async () => {
      db.__state.selectResults.push([
        { sourceMessageId: 'src-1', propertyDefinitionId: 'def-1' },
        { sourceMessageId: 'src-2', propertyDefinitionId: 'def-2' },
      ]);

      const result = await service.getIncomingSources('target-1', 'parent');

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        sourceMessageId: 'src-1',
        propertyDefinitionId: 'def-1',
      });
      expect(result[1]).toMatchObject({
        sourceMessageId: 'src-2',
        propertyDefinitionId: 'def-2',
      });
    });

    it('orders results desc by createdAt (later createdAt appears first)', async () => {
      // The mock returns whatever we seed — we seed in desc order to match
      // what the real DB would return with orderBy(desc(createdAt)).
      // We assert that orderBy was called and that the result preserves the
      // order returned by the DB (which in production is driven by desc()).
      const newerRow = {
        sourceMessageId: 'src-newer',
        propertyDefinitionId: 'def-1',
      };
      const olderRow = {
        sourceMessageId: 'src-older',
        propertyDefinitionId: 'def-2',
      };

      // Seed: newer first (as the real DB would return with DESC)
      db.__state.selectResults.push([newerRow, olderRow]);

      const result = await service.getIncomingSources('target-1', 'parent');

      // Verify orderBy was invoked (i.e., the chain call reaches orderBy)
      expect(db.__queries.select[0].orderBy).toHaveBeenCalled();

      // Verify desc() was called with the createdAt column
      const { desc: descMock } = dbModule as any;
      expect(descMock).toHaveBeenCalledWith(
        schemaModule.messageRelations.createdAt,
      );

      // Result preserves DB order: newer first
      expect(result[0].sourceMessageId).toBe('src-newer');
      expect(result[1].sourceMessageId).toBe('src-older');
    });

    it('seed-based: returns only rows matching the requested relationKind', async () => {
      // Simulate a DB that already filters by relationKind at the query level.
      // Two separate calls with different kinds return distinct rows.

      // First call: 'parent' kind → returns parent sources only
      db.__state.selectResults.push([
        { sourceMessageId: 'src-parent-1', propertyDefinitionId: 'def-p' },
        { sourceMessageId: 'src-parent-2', propertyDefinitionId: 'def-p' },
      ]);
      // Second call: 'related' kind → returns related sources only
      db.__state.selectResults.push([
        { sourceMessageId: 'src-related-1', propertyDefinitionId: 'def-r' },
      ]);

      const parentSources = await service.getIncomingSources(
        'target-x',
        'parent',
      );
      const relatedSources = await service.getIncomingSources(
        'target-x',
        'related',
      );

      // Each call returns distinct rows — the DB mock routes them independently
      expect(parentSources).toHaveLength(2);
      expect(
        parentSources.every((s) => s.propertyDefinitionId === 'def-p'),
      ).toBe(true);

      expect(relatedSources).toHaveLength(1);
      expect(relatedSources[0].sourceMessageId).toBe('src-related-1');

      // Both calls used innerJoin (for isDeleted filtering)
      expect(db.__queries.select[0].innerJoin).toHaveBeenCalled();
      expect(db.__queries.select[1].innerJoin).toHaveBeenCalled();

      // desc() was called twice (once per query)
      const { desc: descMock } = dbModule as any;
      expect(descMock).toHaveBeenCalledTimes(2);
    });

    it('returns empty array when no matching sources', async () => {
      db.__state.selectResults.push([]);

      const result = await service.getIncomingSources('target-1', 'parent');

      expect(result).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // cycle detection
  // ═══════════════════════════════════════════════════════════════════════════

  describe('cycle detection', () => {
    it('rejects direct A→B→A cycle (CTE returns source id at depth 1)', async () => {
      const sourceId = 'msg-A';
      const targetId = 'msg-B';

      // source found
      db.__state.selectResults.push([sourceRow()]);
      // target found
      db.__state.selectResults.push([targetRow({ id: targetId })]);
      // existing edges: empty
      db.__state.selectResults.push([]);
      // CTE returns source id at depth 1 — cycle detected
      db.__state.executeResults.push([{ m: sourceId, depth: 1 }]);

      await expect(
        service.setRelationTargets({
          sourceMessageId: sourceId,
          targetMessageIds: [targetId],
          definition: makeDefinition() as any,
          actorId: 'user-1',
        }),
      ).rejects.toMatchObject({
        response: { code: RELATION_ERROR_CODES.CYCLE_DETECTED },
      });

      expect(db.execute).toHaveBeenCalledTimes(1);
    });

    it('rejects depth-10 ancestor chain', async () => {
      const sourceId = 'msg-A';
      const targetId = 'msg-B';

      // source found
      db.__state.selectResults.push([sourceRow()]);
      // target found
      db.__state.selectResults.push([targetRow({ id: targetId })]);
      // existing edges: empty
      db.__state.selectResults.push([]);
      // CTE returns depth>=10 (chain too long)
      db.__state.executeResults.push([{ m: 'msg-other', depth: 10 }]);

      await expect(
        service.setRelationTargets({
          sourceMessageId: sourceId,
          targetMessageIds: [targetId],
          definition: makeDefinition() as any,
          actorId: 'user-1',
        }),
      ).rejects.toMatchObject({
        response: { code: RELATION_ERROR_CODES.DEPTH_EXCEEDED },
      });

      expect(db.execute).toHaveBeenCalledTimes(1);
    });

    it('allows legal parent assignment when CTE returns empty', async () => {
      const sourceId = 'msg-A';
      const targetId = 'msg-B';

      // source found
      db.__state.selectResults.push([sourceRow()]);
      // target found
      db.__state.selectResults.push([targetRow({ id: targetId })]);
      // existing edges: empty
      db.__state.selectResults.push([]);
      // CTE returns empty — no cycle, depth ok
      db.__state.executeResults.push([]);
      // insert succeeds
      db.__state.insertResults.push([]);

      const result = await service.setRelationTargets({
        sourceMessageId: sourceId,
        targetMessageIds: [targetId],
        definition: makeDefinition() as any,
        actorId: 'user-1',
      });

      expect(result.addedTargetIds).toEqual([targetId]);
      expect(db.execute).toHaveBeenCalledTimes(1);
      expect(db.__queries.insert).toHaveLength(1);
    });

    it('skips cycle check for relationKind=related', async () => {
      const sourceId = 'msg-A';
      const targetId = 'msg-B';

      // source found
      db.__state.selectResults.push([sourceRow()]);
      // target found
      db.__state.selectResults.push([targetRow({ id: targetId })]);
      // existing edges: empty
      db.__state.selectResults.push([]);
      // insert succeeds
      db.__state.insertResults.push([]);

      await service.setRelationTargets({
        sourceMessageId: sourceId,
        targetMessageIds: [targetId],
        definition: makeDefinition({
          config: {
            scope: 'any',
            cardinality: 'multi',
            relationKind: 'related',
          },
        }) as any,
        actorId: 'user-1',
      });

      // execute should NOT have been called — related kind skips cycle detection
      expect(db.execute).not.toHaveBeenCalled();
    });

    it('detects indirect cycle A→B→C→A via ancestor chain', async () => {
      const sourceId = 'msg-A';
      const targetId = 'msg-B';

      // source found
      db.__state.selectResults.push([sourceRow()]);
      // target found
      db.__state.selectResults.push([targetRow({ id: targetId })]);
      // existing edges: empty
      db.__state.selectResults.push([]);
      // CTE returns source id at depth 3 — indirect cycle A→B→C→A
      db.__state.executeResults.push([{ m: sourceId, depth: 3 }]);

      await expect(
        service.setRelationTargets({
          sourceMessageId: sourceId,
          targetMessageIds: [targetId],
          definition: makeDefinition() as any,
          actorId: 'user-1',
        }),
      ).rejects.toMatchObject({
        response: { code: RELATION_ERROR_CODES.CYCLE_DETECTED },
      });

      expect(db.execute).toHaveBeenCalledTimes(1);
    });

    it('skips cycle check for multi-target related-kind (execute never called)', async () => {
      const sourceId = 'msg-A';
      const targetId1 = 'msg-B';
      const targetId2 = 'msg-C';

      // source found
      db.__state.selectResults.push([sourceRow()]);
      // targets found
      db.__state.selectResults.push([
        targetRow({ id: targetId1 }),
        targetRow({ id: targetId2 }),
      ]);
      // existing edges: empty
      db.__state.selectResults.push([]);
      // insert succeeds
      db.__state.insertResults.push([]);

      const result = await service.setRelationTargets({
        sourceMessageId: sourceId,
        targetMessageIds: [targetId1, targetId2],
        definition: makeDefinition({
          config: {
            scope: 'any',
            cardinality: 'multi',
            relationKind: 'related',
          },
        }) as any,
        actorId: 'user-1',
      });

      expect(result.addedTargetIds).toEqual([targetId1, targetId2]);
      // related kind — execute never called for cycle check
      expect(db.execute).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getEffectiveParent
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getEffectiveParent', () => {
    it('returns null when no property row, no relation, and no thread parentId', async () => {
      // 1) no messageProperties row
      db.__state.selectResults.push([]);
      // 2) no relation
      db.__state.selectResults.push([]);
      // 3) message row with no parentId
      db.__state.selectResults.push([{ parentId: null }]);

      const result = await service.getEffectiveParent('msg-1', 'def-1');

      expect(result).toBeNull();
    });

    it('returns { source: thread } when only thread parentId is present', async () => {
      // 1) no messageProperties row
      db.__state.selectResults.push([]);
      // 2) no explicit relation
      db.__state.selectResults.push([]);
      // 3) message has a thread parentId
      db.__state.selectResults.push([{ parentId: 'thread-parent-id' }]);

      const result = await service.getEffectiveParent('msg-1', 'def-1');

      expect(result).toEqual({ id: 'thread-parent-id', source: 'thread' });
    });

    it('returns { source: relation } when an explicit relation exists, overriding thread parentId', async () => {
      // 1) no explicit clear flag
      db.__state.selectResults.push([{ jsonValue: null }]);
      // 2) stored relation found
      db.__state.selectResults.push([
        { targetMessageId: 'relation-parent-id' },
      ]);
      // 3) thread parentId (should be ignored since relation takes priority)
      // (no need to push, we never reach step 3)

      const result = await service.getEffectiveParent('msg-1', 'def-1');

      expect(result).toEqual({ id: 'relation-parent-id', source: 'relation' });
      // Only 2 select queries — stops after finding relation
      expect(db.__queries.select).toHaveLength(2);
    });

    it('returns null when explicitlyCleared=true even if thread parentId exists', async () => {
      // 1) property row with explicitlyCleared flag
      db.__state.selectResults.push([
        { jsonValue: { explicitlyCleared: true } },
      ]);
      // no further queries should be made

      const result = await service.getEffectiveParent('msg-1', 'def-1');

      expect(result).toBeNull();
      // Only 1 select query — short-circuits after finding explicitlyCleared
      expect(db.__queries.select).toHaveLength(1);
    });

    it('returns null when message is not found (message row absent, defensive)', async () => {
      // 1) no property row
      db.__state.selectResults.push([]);
      // 2) no relation
      db.__state.selectResults.push([]);
      // 3) message row absent
      db.__state.selectResults.push([]);

      const result = await service.getEffectiveParent(
        'nonexistent-msg',
        'def-1',
      );

      expect(result).toBeNull();
    });

    it('ignores explicitlyCleared=false and falls through to relation', async () => {
      // 1) property row with explicitlyCleared=false — should NOT short-circuit
      db.__state.selectResults.push([
        { jsonValue: { explicitlyCleared: false } },
      ]);
      // 2) stored relation found
      db.__state.selectResults.push([{ targetMessageId: 'rel-parent' }]);

      const result = await service.getEffectiveParent('msg-1', 'def-1');

      expect(result).toEqual({ id: 'rel-parent', source: 'relation' });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getSubtree
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getSubtree', () => {
    it('returns empty array when rootIds is empty', async () => {
      const result = await service.getSubtree({
        channelId: 'channel-1',
        rootIds: [],
        maxDepth: 3,
        parentDefinitionId: 'def-1',
      });

      expect(result).toEqual([]);
      // No DB query should have been made
      expect(db.execute).not.toHaveBeenCalled();
    });

    it('returns root node at depth 0 with no parent', async () => {
      db.__state.executeResults.push([
        { id: 'root-1', parent_id: null, parent_source: null, depth: 0 },
      ]);

      const result = await service.getSubtree({
        channelId: 'channel-1',
        rootIds: ['root-1'],
        maxDepth: 3,
        parentDefinitionId: 'def-1',
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        messageId: 'root-1',
        effectiveParentId: null,
        parentSource: null,
        depth: 0,
        hasChildren: false,
      });
    });

    it('returns root and descendants up to maxDepth', async () => {
      db.__state.executeResults.push([
        { id: 'root-1', parent_id: null, parent_source: null, depth: 0 },
        {
          id: 'child-1',
          parent_id: 'root-1',
          parent_source: 'thread',
          depth: 1,
        },
        {
          id: 'grandchild-1',
          parent_id: 'child-1',
          parent_source: 'thread',
          depth: 2,
        },
      ]);

      const result = await service.getSubtree({
        channelId: 'channel-1',
        rootIds: ['root-1'],
        maxDepth: 2,
        parentDefinitionId: 'def-1',
      });

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({ messageId: 'root-1', depth: 0 });
      expect(result[1]).toMatchObject({ messageId: 'child-1', depth: 1 });
      expect(result[2]).toMatchObject({ messageId: 'grandchild-1', depth: 2 });
    });

    it('sets hasChildren=true when a node has children in the result set', async () => {
      // root-1 is a parent of child-1, child-1 is a parent of probe-node (depth=maxDepth+1)
      db.__state.executeResults.push([
        { id: 'root-1', parent_id: null, parent_source: null, depth: 0 },
        {
          id: 'child-1',
          parent_id: 'root-1',
          parent_source: 'thread',
          depth: 1,
        },
        // probe-level node at depth 2 (maxDepth=1) — signals child-1 has children
        {
          id: 'probe-1',
          parent_id: 'child-1',
          parent_source: 'thread',
          depth: 2,
        },
      ]);

      const result = await service.getSubtree({
        channelId: 'channel-1',
        rootIds: ['root-1'],
        maxDepth: 1,
        parentDefinitionId: 'def-1',
      });

      // Only depth<=maxDepth nodes visible (root-1 and child-1)
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        messageId: 'root-1',
        hasChildren: true,
      });
      expect(result[1]).toMatchObject({
        messageId: 'child-1',
        hasChildren: true,
      });
    });

    it('drops probe-level nodes (depth > maxDepth) from visible output', async () => {
      db.__state.executeResults.push([
        { id: 'root-1', parent_id: null, parent_source: null, depth: 0 },
        // probe node at depth 1 when maxDepth=0
        {
          id: 'probe-1',
          parent_id: 'root-1',
          parent_source: 'thread',
          depth: 1,
        },
      ]);

      const result = await service.getSubtree({
        channelId: 'channel-1',
        rootIds: ['root-1'],
        maxDepth: 0,
        parentDefinitionId: 'def-1',
      });

      // Only depth=0 node should appear; probe at depth=1 excluded
      expect(result).toHaveLength(1);
      expect(result[0].messageId).toBe('root-1');
      // root-1 has children because probe-1 has parent_id='root-1'
      expect(result[0].hasChildren).toBe(true);
    });

    it('prefers relation edge over thread parentId in parent_source', async () => {
      db.__state.executeResults.push([
        { id: 'root-1', parent_id: null, parent_source: null, depth: 0 },
        {
          id: 'child-1',
          parent_id: 'root-1',
          parent_source: 'relation',
          depth: 1,
        },
      ]);

      const result = await service.getSubtree({
        channelId: 'channel-1',
        rootIds: ['root-1'],
        maxDepth: 2,
        parentDefinitionId: 'def-1',
      });

      expect(result[1]).toMatchObject({
        messageId: 'child-1',
        parentSource: 'relation',
        effectiveParentId: 'root-1',
      });
    });

    it('filters out deleted children (is_deleted=false clause handled by DB)', async () => {
      // The CTE WHERE clause filters deleted messages. The service simply passes
      // on what the DB returns — we verify it does not re-include deleted rows.
      db.__state.executeResults.push([
        { id: 'root-1', parent_id: null, parent_source: null, depth: 0 },
        // Only non-deleted child included by DB
        {
          id: 'child-live',
          parent_id: 'root-1',
          parent_source: 'thread',
          depth: 1,
        },
        // Note: 'child-deleted' would be absent because the CTE filters it out
      ]);

      const result = await service.getSubtree({
        channelId: 'channel-1',
        rootIds: ['root-1'],
        maxDepth: 2,
        parentDefinitionId: 'def-1',
      });

      expect(result).toHaveLength(2);
      expect(result.every((n) => n.messageId !== 'child-deleted')).toBe(true);
    });

    it('handles multiple roots at depth 0', async () => {
      db.__state.executeResults.push([
        { id: 'root-1', parent_id: null, parent_source: null, depth: 0 },
        { id: 'root-2', parent_id: null, parent_source: null, depth: 0 },
        {
          id: 'child-1',
          parent_id: 'root-1',
          parent_source: 'thread',
          depth: 1,
        },
      ]);

      const result = await service.getSubtree({
        channelId: 'channel-1',
        rootIds: ['root-1', 'root-2'],
        maxDepth: 2,
        parentDefinitionId: 'def-1',
      });

      expect(result).toHaveLength(3);
      const root2 = result.find((n) => n.messageId === 'root-2');
      expect(root2).toMatchObject({
        depth: 0,
        effectiveParentId: null,
        parentSource: null,
        hasChildren: false,
      });
    });

    it('CTE SQL includes explicitlyCleared filter in recursive step (§4.1)', async () => {
      // Capture the SQL object passed to db.execute so we can assert the
      // explicitlyCleared guard is present in the recursive step. The mock
      // sql tag (see dbModule above) produces { sql: joinedTemplateStrings, op: 'sql' }
      // so q.sql holds the raw template literal text.
      let capturedSql = '';
      db.execute = jest.fn().mockImplementation((q: any) => {
        capturedSql = typeof q?.sql === 'string' ? q.sql : '';
        return Promise.resolve([]);
      });

      await service.getSubtree({
        channelId: 'c1',
        rootIds: ['r1'],
        maxDepth: 2,
        parentDefinitionId: 'd1',
      });

      // The recursive step must LEFT JOIN im_message_properties aliased as "cleared"
      // and filter out rows where explicitlyCleared is 'true'.
      // This prevents cleared children from appearing as descendants of their
      // thread parent when getTreeSnapshot composes roots + subtree results.
      expect(capturedSql).toMatch(/im_message_properties\s+cleared/);
      expect(capturedSql).toMatch(/explicitlyCleared/);
      expect(capturedSql).toMatch(/<>\s*'true'/);
    });

    it('excludes explicitlyCleared descendants from subtree (post-filter result matches)', async () => {
      // Scenario per spec §4.1:
      //   A (root, depth 0)
      //   B (thread reply of A, explicitlyCleared=true for the parent prop)
      //   C (thread reply of B)
      //
      // The CTE filters B out because its cleared.json_value->>'explicitlyCleared'
      // equals 'true'. Since B is absent, C (B's child) is also unreachable.
      // The mock simulates the DB returning only A — emulating the post-filter result.
      db.__state.executeResults.push([
        { id: 'A', parent_id: null, parent_source: null, depth: 0 },
        // B and C are absent — filtered out by the explicitlyCleared guard in the CTE
      ]);

      const result = await service.getSubtree({
        channelId: 'channel-1',
        rootIds: ['A'],
        maxDepth: 3,
        parentDefinitionId: 'def-parent',
      });

      // Only A should be in the result; B and C are excluded
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        messageId: 'A',
        depth: 0,
        effectiveParentId: null,
        parentSource: null,
        hasChildren: false,
      });
    });

    it('thread reply with explicit parent-relation override does NOT appear under thread parent', async () => {
      // Scenario: Thread T contains reply R (R.parent_id = T). However, R also
      // has an explicit parentMessage relation pointing to X.
      // When getSubtree is called with rootIds=[T], R should NOT appear (its
      // effective parent is X, not T). The DB CTE must exclude R from T's children
      // because R has an explicit parent-relation (NOT EXISTS check fires).
      // We simulate this by having the DB return only T when roots=[T].
      db.__state.executeResults.push([
        { id: 'T', parent_id: null, parent_source: null, depth: 0 },
        // R is absent from T's subtree because R's explicit parent-relation overrides
        // the thread link (T is not R's effective parent).
      ]);

      const result = await service.getSubtree({
        channelId: 'channel-1',
        rootIds: ['T'],
        maxDepth: 3,
        parentDefinitionId: 'def-parent',
      });

      expect(result).toHaveLength(1);
      expect(result[0].messageId).toBe('T');
      // T has no children visible under it (R went to X instead)
      expect(result[0].hasChildren).toBe(false);
    });

    it('thread reply with explicit parent-relation override appears under explicit parent X', async () => {
      // Complement of above: when roots=[X], R DOES appear as a child of X
      // because the explicit relation edge (R→X with kind=parent) is the priority path.
      db.__state.executeResults.push([
        { id: 'X', parent_id: null, parent_source: null, depth: 0 },
        {
          id: 'R',
          parent_id: 'X',
          parent_source: 'relation',
          depth: 1,
        },
      ]);

      const result = await service.getSubtree({
        channelId: 'channel-1',
        rootIds: ['X'],
        maxDepth: 3,
        parentDefinitionId: 'def-parent',
      });

      expect(result).toHaveLength(2);
      const rNode = result.find((n) => n.messageId === 'R');
      expect(rNode).toBeDefined();
      expect(rNode).toMatchObject({
        effectiveParentId: 'X',
        parentSource: 'relation',
      });
    });

    it('CTE SQL uses NOT EXISTS guard to prevent double-counting thread+relation overlap', async () => {
      // Verify the generated CTE SQL contains the NOT EXISTS sub-query that
      // prevents a child from joining via thread link when an explicit parent
      // relation exists for the same definition.
      let capturedSql = '';
      db.execute = jest.fn().mockImplementation((q: any) => {
        capturedSql = typeof q?.sql === 'string' ? q.sql : '';
        return Promise.resolve([]);
      });

      await service.getSubtree({
        channelId: 'c1',
        rootIds: ['r1'],
        maxDepth: 2,
        parentDefinitionId: 'd1',
      });

      // The recursive step must use NOT EXISTS to exclude thread joins when
      // an explicit parent relation covers the same child.
      expect(capturedSql).toMatch(/NOT EXISTS/i);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RelationError + RelationTargetNotFoundError (errors file coverage)
// ═══════════════════════════════════════════════════════════════════════════

describe('RelationError', () => {
  it('is a BadRequestException with correct code', () => {
    const err = new RelationError('SELF_REFERENCE');
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err.getResponse() as any).code).toBe(
      RELATION_ERROR_CODES.SELF_REFERENCE,
    );
    expect((err.getResponse() as any).message).toBe('SELF_REFERENCE');
  });

  it('accepts a custom message', () => {
    const err = new RelationError('SCOPE_VIOLATION', 'custom msg');
    expect((err.getResponse() as any).message).toBe('custom msg');
  });

  it('exposes errorCode property', () => {
    const err = new RelationError('CARDINALITY_EXCEEDED');
    expect(err.errorCode).toBe('CARDINALITY_EXCEEDED');
  });
});

describe('RelationTargetNotFoundError', () => {
  it('is a NotFoundException with TARGET_NOT_FOUND code', () => {
    const err = new RelationTargetNotFoundError('msg-abc');
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err.getResponse() as any).code).toBe(
      RELATION_ERROR_CODES.TARGET_NOT_FOUND,
    );
    expect((err.getResponse() as any).message).toContain('msg-abc');
    expect((err.getResponse() as any).message).toContain('Target');
  });
});

describe('RelationSourceNotFoundError', () => {
  it('is a NotFoundException with TARGET_NOT_FOUND code and source-specific message', () => {
    const err = new RelationSourceNotFoundError('src-xyz');
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err.getResponse() as any).code).toBe(
      RELATION_ERROR_CODES.TARGET_NOT_FOUND,
    );
    expect((err.getResponse() as any).message).toContain('src-xyz');
    expect((err.getResponse() as any).message).toContain('Source message');
  });
});
