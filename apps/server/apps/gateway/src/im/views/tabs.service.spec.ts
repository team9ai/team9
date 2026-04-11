import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';

const dbModule = {
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  asc: jest.fn((value: unknown) => ({ op: 'asc', value })),
};

const schemaModule = {
  channelTabs: {
    id: 'channelTabs.id',
    channelId: 'channelTabs.channelId',
    name: 'channelTabs.name',
    type: 'channelTabs.type',
    viewId: 'channelTabs.viewId',
    isBuiltin: 'channelTabs.isBuiltin',
    order: 'channelTabs.order',
    createdBy: 'channelTabs.createdBy',
    createdAt: 'channelTabs.createdAt',
    updatedAt: 'channelTabs.updatedAt',
  },
  channelViews: {
    id: 'channelViews.id',
    channelId: 'channelViews.channelId',
  },
};

jest.unstable_mockModule('@team9/database', () => dbModule);
jest.unstable_mockModule('@team9/database/schemas', () => schemaModule);
jest.unstable_mockModule('uuid', () => ({
  v7: jest.fn(() => 'tab-uuid'),
}));

// Mock DTOs
jest.unstable_mockModule('./dto/create-tab.dto.js', () => ({
  CreateTabDto: class {},
}));
jest.unstable_mockModule('./dto/update-tab.dto.js', () => ({
  UpdateTabDto: class {},
}));

const { TabsService } = await import('./tabs.service.js');

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

describe('TabsService', () => {
  let service: InstanceType<typeof TabsService>;
  let db: ReturnType<typeof mockDb>;

  const now = new Date('2026-04-01T00:00:00Z');

  function tab(overrides: Record<string, unknown> = {}) {
    return {
      id: 'tab-1',
      channelId: 'channel-1',
      name: 'Messages',
      type: 'messages',
      viewId: null,
      isBuiltin: true,
      order: 0,
      createdBy: 'user-1',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  beforeEach(() => {
    db = mockDb();
    service = new TabsService(db as any);
    jest.clearAllMocks();
  });

  // ==================== findAllByChannel ====================

  it('returns tabs ordered by order', async () => {
    db.__state.selectResults.push([
      tab({ id: 'tab-1', order: 0 }),
      tab({ id: 'tab-2', order: 1, name: 'Files', type: 'files' }),
    ]);

    const result = await service.findAllByChannel('channel-1');

    expect(result).toEqual([
      tab({ id: 'tab-1', order: 0 }),
      tab({ id: 'tab-2', order: 1, name: 'Files', type: 'files' }),
    ]);
    expect(db.__queries.select[0].orderBy).toHaveBeenCalledWith(
      dbModule.asc.mock.results[0].value,
    );
  });

  // ==================== create ====================

  it('creates a tab', async () => {
    // view check not needed for non-view types
    // getMaxOrder → existing tabs
    db.__state.selectResults.push([{ order: 0 }, { order: 1 }]);
    // insert result
    db.__state.insertResults.push([
      tab({
        id: 'tab-uuid',
        name: 'Custom',
        type: 'messages',
        isBuiltin: false,
        order: 2,
      }),
    ]);

    const result = await service.create(
      'channel-1',
      { name: 'Custom', type: 'messages' } as any,
      'user-1',
    );

    expect(result).toEqual(
      tab({
        id: 'tab-uuid',
        name: 'Custom',
        type: 'messages',
        isBuiltin: false,
        order: 2,
      }),
    );
    expect(db.__queries.insert[0].values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'tab-uuid',
        channelId: 'channel-1',
        name: 'Custom',
        type: 'messages',
        isBuiltin: false,
        order: 2,
      }),
    );
  });

  it('view-type tabs require valid viewId', async () => {
    await expect(
      service.create(
        'channel-1',
        { name: 'Table', type: 'table_view' } as any,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('viewId must belong to same channel', async () => {
    // View lookup returns no result (view not found in channel)
    db.__state.selectResults.push([]);

    await expect(
      service.create(
        'channel-1',
        { name: 'Table', type: 'table_view', viewId: 'view-other' } as any,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates a view-type tab when viewId is valid', async () => {
    // View lookup → found
    db.__state.selectResults.push([{ id: 'view-1', channelId: 'channel-1' }]);
    // getMaxOrder
    db.__state.selectResults.push([{ order: 1 }]);
    // insert result
    db.__state.insertResults.push([
      tab({
        id: 'tab-uuid',
        name: 'Table',
        type: 'table_view',
        viewId: 'view-1',
        isBuiltin: false,
        order: 2,
      }),
    ]);

    const result = await service.create(
      'channel-1',
      { name: 'Table', type: 'table_view', viewId: 'view-1' } as any,
      'user-1',
    );

    expect(result.viewId).toBe('view-1');
    expect(result.type).toBe('table_view');
  });

  // ==================== update ====================

  it('partial update of name, order', async () => {
    // findByIdOrThrow → findById
    db.__state.selectResults.push([tab()]);
    // update returning
    db.__state.updateResults.push([tab({ name: 'Renamed', order: 5 })]);

    const result = await service.update('tab-1', {
      name: 'Renamed',
      order: 5,
    } as any);

    expect(result).toEqual(tab({ name: 'Renamed', order: 5 }));
    expect(db.__queries.update[0].set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Renamed',
        order: 5,
        updatedAt: expect.any(Date),
      }),
    );
  });

  it('throws NotFoundException when update target tab is missing', async () => {
    db.__state.selectResults.push([]);

    await expect(
      service.update('missing', { name: 'Nope' } as any),
    ).rejects.toThrow(NotFoundException);
  });

  // ==================== delete ====================

  it('deletes a non-builtin tab', async () => {
    db.__state.selectResults.push([tab({ isBuiltin: false })]);

    await service.delete('tab-1');

    expect(db.__queries.delete).toHaveLength(1);
  });

  it('rejects deleting a builtin tab (throws ForbiddenException)', async () => {
    db.__state.selectResults.push([tab({ isBuiltin: true })]);

    await expect(service.delete('tab-1')).rejects.toThrow(ForbiddenException);
    expect(db.__queries.delete).toHaveLength(0);
  });

  it('throws NotFoundException when deleting a missing tab', async () => {
    db.__state.selectResults.push([]);

    await expect(service.delete('missing')).rejects.toThrow(NotFoundException);
    expect(db.__queries.delete).toHaveLength(0);
  });

  // ==================== reorder ====================

  it('updates order for each tab', async () => {
    await service.reorder('channel-1', ['tab-2', 'tab-1', 'tab-3']);

    expect(db.__queries.update).toHaveLength(3);
    expect(db.__queries.update[0].set).toHaveBeenCalledWith(
      expect.objectContaining({ order: 0, updatedAt: expect.any(Date) }),
    );
    expect(db.__queries.update[1].set).toHaveBeenCalledWith(
      expect.objectContaining({ order: 1, updatedAt: expect.any(Date) }),
    );
    expect(db.__queries.update[2].set).toHaveBeenCalledWith(
      expect.objectContaining({ order: 2, updatedAt: expect.any(Date) }),
    );
  });

  // ==================== seedBuiltinTabs ====================

  it('creates Messages + Files tabs when none exist', async () => {
    // findAllByChannel → empty
    db.__state.selectResults.push([]);
    // insert (batch)
    db.__state.insertResults.push([]);

    await service.seedBuiltinTabs('channel-1');

    expect(db.__queries.insert).toHaveLength(1);
    expect(db.__queries.insert[0].values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          channelId: 'channel-1',
          name: 'Messages',
          type: 'messages',
          isBuiltin: true,
          order: 0,
        }),
        expect.objectContaining({
          channelId: 'channel-1',
          name: 'Files',
          type: 'files',
          isBuiltin: true,
          order: 1,
        }),
      ]),
    );
  });

  it('seedBuiltinTabs is idempotent (skips when all built-in tabs exist)', async () => {
    // findAllByChannel → both builtin tabs already exist
    db.__state.selectResults.push([
      tab({ type: 'messages', isBuiltin: true }),
      tab({ type: 'files', isBuiltin: true }),
    ]);

    await service.seedBuiltinTabs('channel-1');

    expect(db.__queries.insert).toHaveLength(0);
  });

  it('seedBuiltinTabs only inserts missing built-in tabs', async () => {
    // findAllByChannel → only Messages exists
    db.__state.selectResults.push([tab({ type: 'messages', isBuiltin: true })]);
    db.__state.insertResults.push([]);

    await service.seedBuiltinTabs('channel-1');

    expect(db.__queries.insert).toHaveLength(1);
    expect(db.__queries.insert[0].values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Files',
          type: 'files',
          isBuiltin: true,
        }),
      ]),
    );
  });
});
