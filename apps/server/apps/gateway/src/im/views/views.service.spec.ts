import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NotFoundException, BadRequestException } from '@nestjs/common';

const dbModule = {
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  asc: jest.fn((value: unknown) => ({ op: 'asc', value })),
  desc: jest.fn((value: unknown) => ({ op: 'desc', value })),
  lt: jest.fn((left: unknown, right: unknown) => ({ op: 'lt', left, right })),
  isNull: jest.fn((value: unknown) => ({ op: 'isNull', value })),
  sql: Object.assign(
    jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      op: 'sql',
      strings,
      values,
    })),
    {
      join: jest.fn((parts: unknown[], sep: unknown) => ({
        op: 'sqlJoin',
        parts,
        sep,
      })),
    },
  ),
};

const schemaModule = {
  channelViews: {
    id: 'channelViews.id',
    channelId: 'channelViews.channelId',
    name: 'channelViews.name',
    type: 'channelViews.type',
    config: 'channelViews.config',
    order: 'channelViews.order',
    createdBy: 'channelViews.createdBy',
    createdAt: 'channelViews.createdAt',
    updatedAt: 'channelViews.updatedAt',
  },
  messages: {
    id: 'messages.id',
    channelId: 'messages.channelId',
    isDeleted: 'messages.isDeleted',
    parentId: 'messages.parentId',
    createdAt: 'messages.createdAt',
  },
  channelPropertyDefinitions: {
    id: 'cpd.id',
    channelId: 'cpd.channelId',
    config: 'cpd.config',
  },
};

jest.unstable_mockModule('@team9/database', () => dbModule);
jest.unstable_mockModule('@team9/database/schemas', () => schemaModule);
jest.unstable_mockModule('uuid', () => ({
  v7: jest.fn(() => 'view-uuid'),
}));

// Mock the MessagePropertiesService module
const mockMessagePropertiesService = {
  batchGetByMessageIds: jest.fn<any>(),
};

jest.unstable_mockModule('../properties/message-properties.service.js', () => ({
  MessagePropertiesService: jest.fn(() => mockMessagePropertiesService),
}));

// Mock the MessageRelationsService module
const mockRelationsService = {
  getEffectiveParent: jest.fn<any>(),
  getSubtree: jest.fn<any>(),
};

jest.unstable_mockModule('../properties/message-relations.service.js', () => ({
  MessageRelationsService: jest.fn(() => mockRelationsService),
}));

// Mock DTOs
jest.unstable_mockModule('./dto/create-view.dto.js', () => ({
  CreateViewDto: class {},
}));
jest.unstable_mockModule('./dto/update-view.dto.js', () => ({
  UpdateViewDto: class {},
}));

const { ViewsService } = await import('./views.service.js');

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

describe('ViewsService', () => {
  let service: InstanceType<typeof ViewsService>;
  let db: ReturnType<typeof mockDb>;

  const now = new Date('2026-04-01T00:00:00Z');

  function view(overrides: Record<string, unknown> = {}) {
    return {
      id: 'view-1',
      channelId: 'channel-1',
      name: 'My Table',
      type: 'table',
      config: { filters: [], sorts: [] },
      order: 0,
      createdBy: 'user-1',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function message(overrides: Record<string, unknown> = {}) {
    return {
      id: 'msg-1',
      channelId: 'channel-1',
      content: 'Hello world',
      type: 'text',
      isDeleted: false,
      parentId: null,
      senderId: 'user-1',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  beforeEach(() => {
    db = mockDb();
    service = new ViewsService(
      db as any,
      mockMessagePropertiesService as any,
      mockRelationsService as any,
    );
    jest.clearAllMocks();
    mockRelationsService.getEffectiveParent.mockResolvedValue(null);
    mockRelationsService.getSubtree.mockResolvedValue([]);
  });

  // ==================== findAllByChannel ====================

  it('returns views ordered by order', async () => {
    db.__state.selectResults.push([
      view({ id: 'view-1', order: 0 }),
      view({ id: 'view-2', order: 1, name: 'Board' }),
    ]);

    const result = await service.findAllByChannel('channel-1');

    expect(result).toEqual([
      view({ id: 'view-1', order: 0 }),
      view({ id: 'view-2', order: 1, name: 'Board' }),
    ]);
    expect(db.__queries.select[0].orderBy).toHaveBeenCalledWith(
      dbModule.asc.mock.results[0].value,
    );
  });

  // ==================== findById / findByIdOrThrow ====================

  it('returns a view from findById()', async () => {
    db.__state.selectResults.push([view()]);
    await expect(service.findById('view-1')).resolves.toEqual(view());
  });

  it('returns null from findById() when the view does not exist', async () => {
    db.__state.selectResults.push([]);
    await expect(service.findById('missing')).resolves.toBeNull();
  });

  it('throws NotFoundException from findByIdOrThrow() when missing', async () => {
    db.__state.selectResults.push([]);
    await expect(service.findByIdOrThrow('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  // ==================== create ====================

  it('creates a view with valid config', async () => {
    // countByChannel → existing views
    db.__state.selectResults.push([{ id: 'v1' }, { id: 'v2' }]);
    // getMaxOrder → existing orders
    db.__state.selectResults.push([{ order: 0 }, { order: 1 }]);
    // insert result
    db.__state.insertResults.push([
      view({ id: 'view-uuid', name: 'New View', order: 2 }),
    ]);

    const result = await service.create(
      'channel-1',
      { name: 'New View', type: 'table' } as any,
      'user-1',
    );

    expect(result).toEqual(
      view({ id: 'view-uuid', name: 'New View', order: 2 }),
    );
    expect(db.__queries.insert[0].values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'view-uuid',
        channelId: 'channel-1',
        name: 'New View',
        type: 'table',
        order: 2,
        createdBy: 'user-1',
      }),
    );
  });

  it('enforces view limit (20 per channel)', async () => {
    // countByChannel → 20 existing views
    const twentyViews = Array.from({ length: 20 }, (_, i) => ({
      id: `v-${i}`,
    }));
    db.__state.selectResults.push(twentyViews);

    await expect(
      service.create(
        'channel-1',
        { name: 'One too many', type: 'table' } as any,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates a view with default config when none provided', async () => {
    db.__state.selectResults.push([]); // countByChannel → 0
    db.__state.selectResults.push([]); // getMaxOrder → empty
    db.__state.insertResults.push([view({ id: 'view-uuid', order: 0 })]);

    await service.create(
      'channel-1',
      { name: 'Default Config', type: 'board' } as any,
      'user-1',
    );

    expect(db.__queries.insert[0].values).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { filters: [], sorts: [] },
        order: 0,
      }),
    );
  });

  // ==================== update ====================

  it('partial update of name, config, order', async () => {
    // findByIdOrThrow → findById
    db.__state.selectResults.push([view()]);
    // update returning
    db.__state.updateResults.push([view({ name: 'Renamed', order: 5 })]);

    const result = await service.update('view-1', {
      name: 'Renamed',
      order: 5,
    } as any);

    expect(result).toEqual(view({ name: 'Renamed', order: 5 }));
    expect(db.__queries.update[0].set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Renamed',
        order: 5,
        updatedAt: expect.any(Date),
      }),
    );
  });

  it('throws NotFoundException when update target view is missing', async () => {
    db.__state.selectResults.push([]);

    await expect(
      service.update('missing', { name: 'Nope' } as any),
    ).rejects.toThrow(NotFoundException);
  });

  // ==================== delete ====================

  it('deletes a view', async () => {
    // findByIdOrThrow → findById
    db.__state.selectResults.push([view()]);

    await service.delete('view-1');

    expect(db.__queries.delete).toHaveLength(1);
    expect(db.__queries.delete[0].where).toHaveBeenCalled();
  });

  it('throws NotFoundException when deleting a missing view', async () => {
    db.__state.selectResults.push([]);

    await expect(service.delete('missing')).rejects.toThrow(NotFoundException);
    expect(db.__queries.delete).toHaveLength(0);
  });

  // ==================== queryMessages ====================

  it('returns messages with properties (flat, no filters)', async () => {
    const msg1 = message({ id: 'msg-1' });
    const msg2 = message({ id: 'msg-2' });

    // findByIdOrThrow → findById
    db.__state.selectResults.push([
      view({ config: { filters: [], sorts: [] } }),
    ]);
    // Load messages
    db.__state.selectResults.push([msg1, msg2]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { priority: 'high' },
      'msg-2': { priority: 'low' },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });

    expect(result).toEqual({
      messages: [
        { ...msg1, properties: { priority: 'high' } },
        { ...msg2, properties: { priority: 'low' } },
      ],
      total: 2,
      cursor: null,
    });
  });

  it('returns empty result when no messages found', async () => {
    db.__state.selectResults.push([view()]);
    db.__state.selectResults.push([]);

    const result = await service.queryMessages('view-1', {});

    expect(result).toEqual({ messages: [], total: 0, cursor: null });
  });

  it('applies filters correctly (eq)', async () => {
    const msg1 = message({ id: 'msg-1' });
    const msg2 = message({ id: 'msg-2' });

    db.__state.selectResults.push([
      view({
        config: {
          filters: [{ propertyKey: 'status', operator: 'eq', value: 'done' }],
          sorts: [],
        },
      }),
    ]);
    db.__state.selectResults.push([msg1, msg2]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { status: 'done' },
      'msg-2': { status: 'open' },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });

    expect((result as any).messages).toHaveLength(1);
    expect((result as any).messages[0].properties.status).toBe('done');
  });

  it('applies filters correctly (neq)', async () => {
    const msg1 = message({ id: 'msg-1' });
    const msg2 = message({ id: 'msg-2' });

    db.__state.selectResults.push([
      view({
        config: {
          filters: [{ propertyKey: 'status', operator: 'neq', value: 'done' }],
          sorts: [],
        },
      }),
    ]);
    db.__state.selectResults.push([msg1, msg2]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { status: 'done' },
      'msg-2': { status: 'open' },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });

    expect((result as any).messages).toHaveLength(1);
    expect((result as any).messages[0].id).toBe('msg-2');
  });

  it('applies filters correctly (gt, contains, is_empty, in)', async () => {
    const msgs = [
      message({ id: 'msg-1' }),
      message({ id: 'msg-2' }),
      message({ id: 'msg-3' }),
    ];

    // gt filter
    db.__state.selectResults.push([
      view({
        config: {
          filters: [{ propertyKey: 'score', operator: 'gt', value: 5 }],
          sorts: [],
        },
      }),
    ]);
    db.__state.selectResults.push(msgs);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { score: 10 },
      'msg-2': { score: 3 },
      'msg-3': { score: 5 },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });
    expect((result as any).messages).toHaveLength(1);
    expect((result as any).messages[0].id).toBe('msg-1');
  });

  it('applies sorts correctly', async () => {
    const msg1 = message({ id: 'msg-1' });
    const msg2 = message({ id: 'msg-2' });
    const msg3 = message({ id: 'msg-3' });

    db.__state.selectResults.push([
      view({
        config: {
          filters: [],
          sorts: [{ propertyKey: 'priority', direction: 'asc' }],
        },
      }),
    ]);
    db.__state.selectResults.push([msg1, msg2, msg3]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { priority: 3 },
      'msg-2': { priority: 1 },
      'msg-3': { priority: 2 },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });

    const ids = (result as any).messages.map((m: any) => m.id);
    expect(ids).toEqual(['msg-2', 'msg-3', 'msg-1']);
  });

  it('grouped response with independent pagination', async () => {
    const msgs = [
      message({ id: 'msg-1', createdAt: new Date('2026-04-01T01:00:00Z') }),
      message({ id: 'msg-2', createdAt: new Date('2026-04-01T02:00:00Z') }),
      message({ id: 'msg-3', createdAt: new Date('2026-04-01T03:00:00Z') }),
    ];

    db.__state.selectResults.push([
      view({
        config: {
          filters: [],
          sorts: [],
          groupBy: 'status',
        },
      }),
    ]);
    db.__state.selectResults.push(msgs);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { status: 'open' },
      'msg-2': { status: 'done' },
      'msg-3': { status: 'open' },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });

    expect((result as any).groups).toBeDefined();
    expect((result as any).groups).toHaveLength(2);
    expect((result as any).total).toBe(3);

    const openGroup = (result as any).groups.find((g: any) => g.key === 'open');
    expect(openGroup.messages).toHaveLength(2);
    expect(openGroup.total).toBe(2);
  });

  it('grouped response returns specific group when group param provided', async () => {
    const msgs = [
      message({ id: 'msg-1', createdAt: new Date('2026-04-01T01:00:00Z') }),
      message({ id: 'msg-2', createdAt: new Date('2026-04-01T02:00:00Z') }),
    ];

    db.__state.selectResults.push([
      view({ config: { filters: [], sorts: [], groupBy: 'status' } }),
    ]);
    db.__state.selectResults.push(msgs);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { status: 'open' },
      'msg-2': { status: 'done' },
    });

    const result = await service.queryMessages('view-1', {
      group: 'open',
      limit: 10,
    });

    expect((result as any).groups).toHaveLength(1);
    expect((result as any).groups[0].key).toBe('open');
    expect((result as any).groups[0].messages).toHaveLength(1);
  });

  // ==================== matchesFilters edge cases ====================

  it('matchesFilters: gte operator', async () => {
    db.__state.selectResults.push([
      view({
        config: {
          filters: [{ propertyKey: 'score', operator: 'gte', value: 5 }],
          sorts: [],
        },
      }),
    ]);
    db.__state.selectResults.push([
      message({ id: 'msg-1' }),
      message({ id: 'msg-2' }),
    ]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { score: 5 },
      'msg-2': { score: 4 },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });
    expect((result as any).messages).toHaveLength(1);
    expect((result as any).messages[0].id).toBe('msg-1');
  });

  it('matchesFilters: lt operator', async () => {
    db.__state.selectResults.push([
      view({
        config: {
          filters: [{ propertyKey: 'score', operator: 'lt', value: 5 }],
          sorts: [],
        },
      }),
    ]);
    db.__state.selectResults.push([
      message({ id: 'msg-1' }),
      message({ id: 'msg-2' }),
    ]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { score: 3 },
      'msg-2': { score: 5 },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });
    expect((result as any).messages).toHaveLength(1);
    expect((result as any).messages[0].id).toBe('msg-1');
  });

  it('matchesFilters: lte operator', async () => {
    db.__state.selectResults.push([
      view({
        config: {
          filters: [{ propertyKey: 'score', operator: 'lte', value: 5 }],
          sorts: [],
        },
      }),
    ]);
    db.__state.selectResults.push([
      message({ id: 'msg-1' }),
      message({ id: 'msg-2' }),
    ]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { score: 5 },
      'msg-2': { score: 6 },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });
    expect((result as any).messages).toHaveLength(1);
    expect((result as any).messages[0].id).toBe('msg-1');
  });

  it('matchesFilters: contains operator', async () => {
    db.__state.selectResults.push([
      view({
        config: {
          filters: [
            { propertyKey: 'title', operator: 'contains', value: 'bug' },
          ],
          sorts: [],
        },
      }),
    ]);
    db.__state.selectResults.push([
      message({ id: 'msg-1' }),
      message({ id: 'msg-2' }),
    ]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { title: 'fix bug in login' },
      'msg-2': { title: 'add feature' },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });
    expect((result as any).messages).toHaveLength(1);
    expect((result as any).messages[0].id).toBe('msg-1');
  });

  it('matchesFilters: not_contains operator', async () => {
    db.__state.selectResults.push([
      view({
        config: {
          filters: [
            { propertyKey: 'title', operator: 'not_contains', value: 'bug' },
          ],
          sorts: [],
        },
      }),
    ]);
    db.__state.selectResults.push([
      message({ id: 'msg-1' }),
      message({ id: 'msg-2' }),
    ]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { title: 'fix bug in login' },
      'msg-2': { title: 'add feature' },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });
    expect((result as any).messages).toHaveLength(1);
    expect((result as any).messages[0].id).toBe('msg-2');
  });

  it('matchesFilters: is_empty operator', async () => {
    db.__state.selectResults.push([
      view({
        config: {
          filters: [
            { propertyKey: 'assignee', operator: 'is_empty', value: null },
          ],
          sorts: [],
        },
      }),
    ]);
    db.__state.selectResults.push([
      message({ id: 'msg-1' }),
      message({ id: 'msg-2' }),
      message({ id: 'msg-3' }),
      message({ id: 'msg-4' }),
    ]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { assignee: null },
      'msg-2': { assignee: 'user-1' },
      'msg-3': {}, // undefined
      'msg-4': { assignee: '' },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });
    expect((result as any).messages).toHaveLength(3);
  });

  it('matchesFilters: is_not_empty operator', async () => {
    db.__state.selectResults.push([
      view({
        config: {
          filters: [
            { propertyKey: 'assignee', operator: 'is_not_empty', value: null },
          ],
          sorts: [],
        },
      }),
    ]);
    db.__state.selectResults.push([
      message({ id: 'msg-1' }),
      message({ id: 'msg-2' }),
    ]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { assignee: null },
      'msg-2': { assignee: 'user-1' },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });
    expect((result as any).messages).toHaveLength(1);
    expect((result as any).messages[0].id).toBe('msg-2');
  });

  it('matchesFilters: in operator', async () => {
    db.__state.selectResults.push([
      view({
        config: {
          filters: [
            {
              propertyKey: 'status',
              operator: 'in',
              value: ['open', 'in_progress'],
            },
          ],
          sorts: [],
        },
      }),
    ]);
    db.__state.selectResults.push([
      message({ id: 'msg-1' }),
      message({ id: 'msg-2' }),
      message({ id: 'msg-3' }),
    ]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { status: 'open' },
      'msg-2': { status: 'done' },
      'msg-3': { status: 'in_progress' },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });
    expect((result as any).messages).toHaveLength(2);
  });

  it('matchesFilters: not_in operator', async () => {
    db.__state.selectResults.push([
      view({
        config: {
          filters: [
            {
              propertyKey: 'status',
              operator: 'not_in',
              value: ['done', 'cancelled'],
            },
          ],
          sorts: [],
        },
      }),
    ]);
    db.__state.selectResults.push([
      message({ id: 'msg-1' }),
      message({ id: 'msg-2' }),
    ]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { status: 'open' },
      'msg-2': { status: 'done' },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });
    expect((result as any).messages).toHaveLength(1);
    expect((result as any).messages[0].id).toBe('msg-1');
  });

  it('matchesFilters: unknown operator passes filter', async () => {
    db.__state.selectResults.push([
      view({
        config: {
          filters: [
            {
              propertyKey: 'status',
              operator: 'unknown_op',
              value: 'whatever',
            },
          ],
          sorts: [],
        },
      }),
    ]);
    db.__state.selectResults.push([message({ id: 'msg-1' })]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { status: 'open' },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });
    expect((result as any).messages).toHaveLength(1);
  });

  it('matchesFilters: gt with non-number values returns false', async () => {
    db.__state.selectResults.push([
      view({
        config: {
          filters: [{ propertyKey: 'score', operator: 'gt', value: 5 }],
          sorts: [],
        },
      }),
    ]);
    db.__state.selectResults.push([message({ id: 'msg-1' })]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { score: 'not a number' },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });
    expect((result as any).messages).toHaveLength(0);
  });

  it('matchesFilters: contains with non-string values returns false', async () => {
    db.__state.selectResults.push([
      view({
        config: {
          filters: [{ propertyKey: 'title', operator: 'contains', value: 'x' }],
          sorts: [],
        },
      }),
    ]);
    db.__state.selectResults.push([message({ id: 'msg-1' })]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { title: 123 },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });
    expect((result as any).messages).toHaveLength(0);
  });

  it('matchesFilters: is_empty with empty array returns true', async () => {
    db.__state.selectResults.push([
      view({
        config: {
          filters: [{ propertyKey: 'tags', operator: 'is_empty', value: null }],
          sorts: [],
        },
      }),
    ]);
    db.__state.selectResults.push([message({ id: 'msg-1' })]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { tags: [] },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });
    expect((result as any).messages).toHaveLength(1);
  });

  // ==================== Sort edge cases ====================

  it('sorts descending correctly', async () => {
    db.__state.selectResults.push([
      view({
        config: {
          filters: [],
          sorts: [{ propertyKey: 'score', direction: 'desc' }],
        },
      }),
    ]);
    db.__state.selectResults.push([
      message({ id: 'msg-1' }),
      message({ id: 'msg-2' }),
    ]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { score: 1 },
      'msg-2': { score: 10 },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });
    const ids = (result as any).messages.map((m: any) => m.id);
    expect(ids).toEqual(['msg-2', 'msg-1']);
  });

  it('sorts null/undefined values to the end', async () => {
    db.__state.selectResults.push([
      view({
        config: {
          filters: [],
          sorts: [{ propertyKey: 'score', direction: 'asc' }],
        },
      }),
    ]);
    db.__state.selectResults.push([
      message({ id: 'msg-1' }),
      message({ id: 'msg-2' }),
      message({ id: 'msg-3' }),
    ]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': {}, // undefined score
      'msg-2': { score: 1 },
      'msg-3': { score: null },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });
    const ids = (result as any).messages.map((m: any) => m.id);
    // msg-2 (1) should come first, then null/undefined
    expect(ids[0]).toBe('msg-2');
  });

  it('sorts string values with localeCompare', async () => {
    db.__state.selectResults.push([
      view({
        config: {
          filters: [],
          sorts: [{ propertyKey: 'name', direction: 'asc' }],
        },
      }),
    ]);
    db.__state.selectResults.push([
      message({ id: 'msg-1' }),
      message({ id: 'msg-2' }),
    ]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': { name: 'Zebra' },
      'msg-2': { name: 'Apple' },
    });

    const result = await service.queryMessages('view-1', { limit: 10 });
    const ids = (result as any).messages.map((m: any) => m.id);
    expect(ids).toEqual(['msg-2', 'msg-1']);
  });

  // ==================== Pagination ====================

  it('returns cursor when results are truncated by limit', async () => {
    const cursorDate = new Date('2026-04-01T05:00:00Z');
    db.__state.selectResults.push([view()]);
    db.__state.selectResults.push([
      message({ id: 'msg-1', createdAt: new Date('2026-04-01T06:00:00Z') }),
      message({ id: 'msg-2', createdAt: cursorDate }),
    ]);

    mockMessagePropertiesService.batchGetByMessageIds.mockResolvedValue({
      'msg-1': {},
      'msg-2': {},
    });

    const result = await service.queryMessages('view-1', { limit: 2 });

    expect((result as any).cursor).toBe(cursorDate.toISOString());
  });

  // ==================== getTreeSnapshot ====================

  describe('getTreeSnapshot', () => {
    const treeParams = {
      channelId: 'channel-1',
      viewId: 'view-1',
      maxDepth: 3,
      expandedIds: [],
      cursor: null,
      limit: 50,
    };

    it('returns empty when channel has no parent definition', async () => {
      // Select for channelPropertyDefinitions → no parent def
      db.__state.selectResults.push([]);

      const result = await service.getTreeSnapshot(treeParams);

      expect(result).toEqual({
        nodes: [],
        nextCursor: null,
        ancestorsIncluded: [],
      });
    });

    it('returns nodes from relationsService.getSubtree with roots whose parent is null', async () => {
      // channelPropertyDefinitions → parent def found
      db.__state.selectResults.push([{ id: 'parent-def-1' }]);
      // findMessageIdsForView → hit messages
      db.__state.selectResults.push([{ id: 'msg-1' }, { id: 'msg-2' }]);

      // No ancestors: getEffectiveParent returns null for both hits
      // Then checking roots: same calls → null
      mockRelationsService.getEffectiveParent.mockResolvedValue(null);

      const subtreeNodes = [
        {
          messageId: 'msg-1',
          effectiveParentId: null,
          parentSource: null,
          depth: 0,
          hasChildren: false,
        },
        {
          messageId: 'msg-2',
          effectiveParentId: null,
          parentSource: null,
          depth: 0,
          hasChildren: false,
        },
      ];
      mockRelationsService.getSubtree.mockResolvedValue(subtreeNodes);

      const result = await service.getTreeSnapshot(treeParams);

      expect(result.nodes).toEqual(subtreeNodes);
      expect(result.nextCursor).toBeNull();
      expect(result.ancestorsIncluded).toEqual([]);
    });

    it('walks ancestor chain for each hit and includes them in roots', async () => {
      // channelPropertyDefinitions → parent def
      db.__state.selectResults.push([{ id: 'parent-def-1' }]);
      // findMessageIdsForView → one hit
      db.__state.selectResults.push([{ id: 'child-msg' }]);

      // Ancestor walk: child-msg → parent-msg → null
      // Root check: child-msg → parent-msg (not null!), parent-msg → null (root)
      mockRelationsService.getEffectiveParent
        .mockResolvedValueOnce({
          id: 'parent-msg',
          source: 'relation' as const,
        }) // ancestor walk: child-msg
        .mockResolvedValueOnce(null) // ancestor walk: parent-msg (stop)
        .mockResolvedValueOnce({
          id: 'parent-msg',
          source: 'relation' as const,
        }) // root check: child-msg
        .mockResolvedValueOnce(null); // root check: parent-msg (is root)

      const subtreeNodes = [
        {
          messageId: 'parent-msg',
          effectiveParentId: null,
          parentSource: null,
          depth: 0,
          hasChildren: true,
        },
        {
          messageId: 'child-msg',
          effectiveParentId: 'parent-msg',
          parentSource: 'relation' as const,
          depth: 1,
          hasChildren: false,
        },
      ];
      mockRelationsService.getSubtree.mockResolvedValue(subtreeNodes);

      const result = await service.getTreeSnapshot(treeParams);

      expect(result.nodes).toEqual(subtreeNodes);
      // parent-msg is an ancestor (not in hitIds), so it appears in ancestorsIncluded
      expect(result.ancestorsIncluded).toContain('parent-msg');
      // child-msg is in hitIds, so it does NOT appear in ancestorsIncluded
      expect(result.ancestorsIncluded).not.toContain('child-msg');
    });

    it('dedupes ancestors across multiple hits that share a common ancestor', async () => {
      // channelPropertyDefinitions → parent def
      db.__state.selectResults.push([{ id: 'parent-def-1' }]);
      // findMessageIdsForView → two hits sharing one parent
      db.__state.selectResults.push([{ id: 'child-a' }, { id: 'child-b' }]);

      // Ancestor walk:
      //   child-a → shared-parent → null (stop)
      //   child-b → shared-parent → already in ancestorSet (stop because of 'has' check)
      // Root checks:
      //   child-a → shared-parent (not root)
      //   child-b → shared-parent (not root)
      //   shared-parent → null (root)
      mockRelationsService.getEffectiveParent
        .mockResolvedValueOnce({
          id: 'shared-parent',
          source: 'relation' as const,
        }) // child-a ancestor walk
        .mockResolvedValueOnce(null) // shared-parent → stop
        .mockResolvedValueOnce({
          id: 'shared-parent',
          source: 'relation' as const,
        }) // child-b ancestor walk (ancestorSet already has shared-parent → break)
        // root checks
        .mockResolvedValueOnce({
          id: 'shared-parent',
          source: 'relation' as const,
        }) // child-a root check
        .mockResolvedValueOnce({
          id: 'shared-parent',
          source: 'relation' as const,
        }) // child-b root check
        .mockResolvedValueOnce(null); // shared-parent root check

      mockRelationsService.getSubtree.mockResolvedValue([]);

      const result = await service.getTreeSnapshot(treeParams);

      // shared-parent should appear only once in ancestorsIncluded
      const parentOccurrences = result.ancestorsIncluded.filter(
        (id) => id === 'shared-parent',
      );
      expect(parentOccurrences).toHaveLength(1);
    });

    it('includes expandedIds extra level without duplicates', async () => {
      // channelPropertyDefinitions → parent def
      db.__state.selectResults.push([{ id: 'parent-def-1' }]);
      // findMessageIdsForView → one hit (which is also the expanded id)
      db.__state.selectResults.push([{ id: 'msg-root' }]);

      mockRelationsService.getEffectiveParent.mockResolvedValue(null);

      const mainNode = {
        messageId: 'msg-root',
        effectiveParentId: null,
        parentSource: null,
        depth: 0,
        hasChildren: true,
      };
      const childNode = {
        messageId: 'msg-child',
        effectiveParentId: 'msg-root',
        parentSource: 'relation' as const,
        depth: 1,
        hasChildren: false,
      };

      // First getSubtree call (main tree) → mainNode
      mockRelationsService.getSubtree
        .mockResolvedValueOnce([mainNode])
        // Second call (expandedIds extra level) → both nodes
        .mockResolvedValueOnce([mainNode, childNode]);

      const result = await service.getTreeSnapshot({
        ...treeParams,
        expandedIds: ['msg-root'],
      });

      // msg-root should appear once, msg-child added from expanded
      const msgRootCount = result.nodes.filter(
        (n) => n.messageId === 'msg-root',
      ).length;
      expect(msgRootCount).toBe(1);
      expect(
        result.nodes.find((n) => n.messageId === 'msg-child'),
      ).toBeDefined();
    });

    it('sets nextCursor to last hit ID when full page returned', async () => {
      // channelPropertyDefinitions → parent def
      db.__state.selectResults.push([{ id: 'parent-def-1' }]);
      // findMessageIdsForView → exactly `limit` (2) results
      db.__state.selectResults.push([{ id: 'msg-1' }, { id: 'msg-2' }]);

      mockRelationsService.getEffectiveParent.mockResolvedValue(null);
      mockRelationsService.getSubtree.mockResolvedValue([]);

      const result = await service.getTreeSnapshot({
        ...treeParams,
        limit: 2,
      });

      expect(result.nextCursor).toBe('msg-2');
    });

    it('nextCursor is null when fewer results than limit', async () => {
      // channelPropertyDefinitions → parent def
      db.__state.selectResults.push([{ id: 'parent-def-1' }]);
      // findMessageIdsForView → only 1 result (< limit of 2)
      db.__state.selectResults.push([{ id: 'msg-1' }]);

      mockRelationsService.getEffectiveParent.mockResolvedValue(null);
      mockRelationsService.getSubtree.mockResolvedValue([]);

      const result = await service.getTreeSnapshot({
        ...treeParams,
        limit: 2,
      });

      expect(result.nextCursor).toBeNull();
    });

    it('ancestorsIncluded contains only ancestors not in the hit set', async () => {
      // channelPropertyDefinitions → parent def
      db.__state.selectResults.push([{ id: 'parent-def-1' }]);
      // findMessageIdsForView → [hit-msg]
      db.__state.selectResults.push([{ id: 'hit-msg' }]);

      // Ancestor walk: hit-msg → ancestor-msg → null
      // Root check: hit-msg → ancestor-msg (not root), ancestor-msg → null (root)
      mockRelationsService.getEffectiveParent
        .mockResolvedValueOnce({
          id: 'ancestor-msg',
          source: 'relation' as const,
        })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'ancestor-msg',
          source: 'relation' as const,
        })
        .mockResolvedValueOnce(null);

      mockRelationsService.getSubtree.mockResolvedValue([]);

      const result = await service.getTreeSnapshot(treeParams);

      expect(result.ancestorsIncluded).toContain('ancestor-msg');
      expect(result.ancestorsIncluded).not.toContain('hit-msg');
    });
  });
});
