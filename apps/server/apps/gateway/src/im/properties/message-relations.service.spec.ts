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
