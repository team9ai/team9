import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const dbModule = {
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  desc: jest.fn((value: unknown) => ({ op: 'desc', value })),
  lt: jest.fn((left: unknown, right: unknown) => ({ op: 'lt', left, right })),
};

const schemaModule = {
  auditLogs: {
    id: 'auditLogs.id',
    channelId: 'auditLogs.channelId',
    entityType: 'auditLogs.entityType',
    entityId: 'auditLogs.entityId',
    action: 'auditLogs.action',
    changes: 'auditLogs.changes',
    performedBy: 'auditLogs.performedBy',
    metadata: 'auditLogs.metadata',
    createdAt: 'auditLogs.createdAt',
  },
};

jest.unstable_mockModule('@team9/database', () => dbModule);
jest.unstable_mockModule('@team9/database/schemas', () => schemaModule);

const { AuditService } = await import('./audit.service.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

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
  ] as const) {
    query[key].mockReturnValue(query as never);
  }

  return query;
}

function mockDb() {
  const state = {
    selectResults: [] as unknown[][],
    insertResults: [] as unknown[][],
    updateResults: [] as unknown[][],
    deleteResults: [] as unknown[][],
  };

  const db = {
    __state: state,
    __queries: {
      select: [] as ReturnType<typeof createQuery>[],
      insert: [] as ReturnType<typeof createQuery>[],
      update: [] as ReturnType<typeof createQuery>[],
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
    update: jest.fn((...args: unknown[]) => {
      const query = createQuery(state.updateResults.shift());
      (query as any).args = args;
      db.__queries.update.push(query);
      return query as never;
    }),
    delete: jest.fn((...args: unknown[]) => {
      const query = createQuery(state.deleteResults.shift());
      (query as any).args = args;
      db.__queries.delete.push(query);
      return query as never;
    }),
  };

  return db;
}

describe('AuditService', () => {
  let service: InstanceType<typeof AuditService>;
  let db: ReturnType<typeof mockDb>;

  const now = new Date('2026-04-01T00:00:00Z');

  function logRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'log-1',
      channelId: 'channel-1',
      entityType: 'message',
      entityId: 'msg-1',
      action: 'property_set',
      changes: { priority: { old: null, new: 'high' } },
      performedBy: 'user-1',
      metadata: { definitionId: 'def-1' },
      createdAt: now,
      ...overrides,
    };
  }

  beforeEach(() => {
    db = mockDb();
    service = new AuditService(db as any);
    jest.clearAllMocks();
  });

  // ==================== log ====================

  it('log() inserts audit log entry with all fields', async () => {
    db.__state.insertResults.push([]);

    await service.log({
      channelId: 'channel-1',
      entityType: 'message',
      entityId: 'msg-1',
      action: 'property_set',
      changes: { priority: { old: null, new: 'high' } },
      performedBy: 'user-1',
      metadata: { definitionId: 'def-1' },
    });

    expect(db.__queries.insert).toHaveLength(1);
    expect(db.__queries.insert[0].values).toHaveBeenCalledWith({
      channelId: 'channel-1',
      entityType: 'message',
      entityId: 'msg-1',
      action: 'property_set',
      changes: { priority: { old: null, new: 'high' } },
      performedBy: 'user-1',
      metadata: { definitionId: 'def-1' },
    });
  });

  it('log() handles optional fields (channelId, performedBy, metadata)', async () => {
    db.__state.insertResults.push([]);

    await service.log({
      entityType: 'channel',
      entityId: 'channel-1',
      action: 'channel_created',
      changes: {},
    });

    expect(db.__queries.insert[0].values).toHaveBeenCalledWith({
      channelId: undefined,
      entityType: 'channel',
      entityId: 'channel-1',
      action: 'channel_created',
      changes: {},
      performedBy: undefined,
      metadata: null,
    });
  });

  // ==================== findByChannel ====================

  it('findByChannel() returns logs ordered by createdAt DESC', async () => {
    const logs = [
      logRow({ id: 'log-2', createdAt: new Date('2026-04-02') }),
      logRow({ id: 'log-1', createdAt: now }),
    ];
    db.__state.selectResults.push(logs);

    const result = await service.findByChannel('channel-1');

    expect(result.logs).toEqual(logs);
    expect(result.nextCursor).toBeNull();
    expect(db.__queries.select[0].orderBy).toHaveBeenCalled();
  });

  it('findByChannel() cursor pagination works correctly', async () => {
    db.__state.selectResults.push([logRow()]);

    const result = await service.findByChannel('channel-1', {
      cursor: '2026-04-02T00:00:00.000Z',
    });

    expect(result.logs).toEqual([logRow()]);
    // lt should have been called for cursor filtering
    expect(dbModule.lt).toHaveBeenCalled();
  });

  it('findByChannel() filters by entityType', async () => {
    db.__state.selectResults.push([logRow()]);

    await service.findByChannel('channel-1', { entityType: 'message' });

    // eq called for channelId and entityType
    expect(dbModule.eq).toHaveBeenCalledWith(
      schemaModule.auditLogs.entityType,
      'message',
    );
  });

  it('findByChannel() filters by action', async () => {
    db.__state.selectResults.push([logRow()]);

    await service.findByChannel('channel-1', { action: 'property_set' });

    expect(dbModule.eq).toHaveBeenCalledWith(
      schemaModule.auditLogs.action,
      'property_set',
    );
  });

  it('findByChannel() returns nextCursor when more results exist', async () => {
    // Default limit is 50, so push 51 items
    const logs = Array.from({ length: 51 }, (_, i) =>
      logRow({
        id: `log-${i}`,
        createdAt: new Date(
          `2026-04-01T00:00:${String(50 - i).padStart(2, '0')}.000Z`,
        ),
      }),
    );
    db.__state.selectResults.push(logs);

    const result = await service.findByChannel('channel-1');

    expect(result.logs).toHaveLength(50);
    expect(result.nextCursor).not.toBeNull();
    // nextCursor should be the createdAt of the last returned log
    expect(result.nextCursor).toBe(result.logs[49].createdAt.toISOString());
  });

  it('findByChannel() returns null nextCursor on last page', async () => {
    db.__state.selectResults.push([logRow()]);

    const result = await service.findByChannel('channel-1');

    expect(result.nextCursor).toBeNull();
  });

  // ==================== findByEntity ====================

  it('findByEntity() returns logs for specific entity', async () => {
    const logs = [logRow()];
    db.__state.selectResults.push(logs);

    const result = await service.findByEntity('message', 'msg-1');

    expect(result.logs).toEqual(logs);
    expect(dbModule.eq).toHaveBeenCalledWith(
      schemaModule.auditLogs.entityType,
      'message',
    );
    expect(dbModule.eq).toHaveBeenCalledWith(
      schemaModule.auditLogs.entityId,
      'msg-1',
    );
  });
});
