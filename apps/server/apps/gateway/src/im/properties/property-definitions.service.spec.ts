import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';

const dbModule = {
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  asc: jest.fn((value: unknown) => ({ op: 'asc', value })),
};

const schemaModule = {
  channelPropertyDefinitions: {
    id: 'cpd.id',
    channelId: 'cpd.channelId',
    key: 'cpd.key',
    description: 'cpd.description',
    valueType: 'cpd.valueType',
    isNative: 'cpd.isNative',
    config: 'cpd.config',
    order: 'cpd.order',
    aiAutoFill: 'cpd.aiAutoFill',
    aiAutoFillPrompt: 'cpd.aiAutoFillPrompt',
    isRequired: 'cpd.isRequired',
    defaultValue: 'cpd.defaultValue',
    showInChatPolicy: 'cpd.showInChatPolicy',
    allowNewOptions: 'cpd.allowNewOptions',
    createdBy: 'cpd.createdBy',
    createdAt: 'cpd.createdAt',
    updatedAt: 'cpd.updatedAt',
  },
};

jest.unstable_mockModule('@team9/database', () => dbModule);
jest.unstable_mockModule('@team9/database/schemas', () => schemaModule);

let uuidCounter = 0;
jest.unstable_mockModule('uuid', () => ({
  v7: jest.fn(() => `uuid-${++uuidCounter}`),
}));

const { PropertyDefinitionsService } =
  await import('./property-definitions.service.js');

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
    // transaction: passes the db itself as the tx argument to the callback
    transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb(db);
    }),
  };

  return db;
}

describe('PropertyDefinitionsService', () => {
  let service: InstanceType<typeof PropertyDefinitionsService>;
  let db: ReturnType<typeof mockDb>;

  const now = new Date('2026-04-01T00:00:00Z');

  function defRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'def-1',
      channelId: 'channel-1',
      key: 'priority',
      description: 'Priority level',
      valueType: 'single_select',
      isNative: false,
      config: {},
      order: 0,
      aiAutoFill: true,
      aiAutoFillPrompt: null,
      isRequired: false,
      defaultValue: null,
      showInChatPolicy: 'auto',
      allowNewOptions: true,
      createdBy: 'user-1',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  beforeEach(() => {
    db = mockDb();
    service = new PropertyDefinitionsService(db as any);
    uuidCounter = 0;
    jest.clearAllMocks();
  });

  // ==================== findAllByChannel ====================

  it('findAllByChannel returns definitions ordered by order', async () => {
    db.__state.selectResults.push([
      defRow({ id: 'def-1', order: 0 }),
      defRow({ id: 'def-2', order: 1 }),
    ]);

    const result = await service.findAllByChannel('channel-1');

    expect(result).toEqual([
      defRow({ id: 'def-1', order: 0 }),
      defRow({ id: 'def-2', order: 1 }),
    ]);
    expect(db.__queries.select[0].orderBy).toHaveBeenCalled();
  });

  // ==================== create ====================

  it('create() creates definition and returns it', async () => {
    // findByKey select: no existing
    db.__state.selectResults.push([]);
    // getMaxOrder select: no rows => -1
    db.__state.selectResults.push([]);
    // insert returning
    db.__state.insertResults.push([
      defRow({ id: 'uuid-1', key: 'status', order: 0 }),
    ]);

    const result = await service.create(
      'channel-1',
      { key: 'status', valueType: 'single_select' } as any,
      'user-1',
    );

    expect(result).toEqual(defRow({ id: 'uuid-1', key: 'status', order: 0 }));
    expect(db.__queries.insert[0].values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'uuid-1',
        channelId: 'channel-1',
        key: 'status',
      }),
    );
  });

  it('create() rejects duplicate key (throws ConflictException)', async () => {
    // findByKey returns existing
    db.__state.selectResults.push([defRow({ key: 'status' })]);

    await expect(
      service.create(
        'channel-1',
        { key: 'status', valueType: 'text' } as any,
        'user-1',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('create() rejects _ prefix for non-native (throws BadRequestException)', async () => {
    await expect(
      service.create(
        'channel-1',
        { key: '_reserved', valueType: 'text' } as any,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // ==================== update ====================

  it('update() partial update works', async () => {
    // findByIdOrThrow -> findById select
    db.__state.selectResults.push([defRow()]);
    // update returning
    db.__state.updateResults.push([defRow({ description: 'Updated desc' })]);

    const result = await service.update('def-1', {
      description: 'Updated desc',
    } as any);

    expect(result).toEqual(defRow({ description: 'Updated desc' }));
    expect(db.__queries.update[0].set).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Updated desc',
        updatedAt: expect.any(Date),
      }),
    );
  });

  // ==================== delete ====================

  it('delete() deletes non-native definition', async () => {
    // findByIdOrThrow -> findById select
    db.__state.selectResults.push([defRow({ isNative: false })]);

    await service.delete('def-1');

    expect(db.__queries.delete).toHaveLength(1);
  });

  it('delete() rejects native definition (throws ForbiddenException)', async () => {
    // findByIdOrThrow -> findById select
    db.__state.selectResults.push([defRow({ isNative: true })]);

    await expect(service.delete('def-1')).rejects.toThrow(ForbiddenException);
    expect(db.__queries.delete).toHaveLength(0);
  });

  // ==================== reorder ====================

  it('reorder() updates order for each definition', async () => {
    // Each update call uses an updateResult (but no returning needed, uses void)
    db.__state.updateResults.push([], []);
    // findAllByChannel select after reorder
    db.__state.selectResults.push([
      defRow({ id: 'def-a', order: 0 }),
      defRow({ id: 'def-b', order: 1 }),
    ]);

    const result = await service.reorder('channel-1', ['def-a', 'def-b']);

    expect(result).toEqual([
      defRow({ id: 'def-a', order: 0 }),
      defRow({ id: 'def-b', order: 1 }),
    ]);
    expect(db.__queries.update).toHaveLength(2);
    expect(db.__queries.update[0].set).toHaveBeenCalledWith(
      expect.objectContaining({ order: 0, updatedAt: expect.any(Date) }),
    );
    expect(db.__queries.update[1].set).toHaveBeenCalledWith(
      expect.objectContaining({ order: 1, updatedAt: expect.any(Date) }),
    );
  });

  // ==================== seedNativeProperties ====================

  it('seedNativeProperties() inserts 4 native definitions', async () => {
    // findAllByChannel: no existing
    db.__state.selectResults.push([]);
    // insert returning
    db.__state.insertResults.push([
      defRow({ key: '_tags', isNative: true, order: 0 }),
      defRow({ key: '_people', isNative: true, order: 1 }),
      defRow({ key: '_tasks', isNative: true, order: 2 }),
      defRow({ key: '_messages', isNative: true, order: 3 }),
    ]);

    const result = await service.seedNativeProperties('channel-1', 'user-1');

    expect(result).toHaveLength(4);
    expect(db.__queries.insert[0].values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ key: '_tags', isNative: true }),
        expect.objectContaining({ key: '_people', isNative: true }),
        expect.objectContaining({ key: '_tasks', isNative: true }),
        expect.objectContaining({ key: '_messages', isNative: true }),
      ]),
    );
  });

  it('seedNativeProperties() is idempotent (no duplicates on second call)', async () => {
    // findAllByChannel: all 4 already exist
    db.__state.selectResults.push([
      defRow({ key: '_tags', isNative: true }),
      defRow({ key: '_people', isNative: true }),
      defRow({ key: '_tasks', isNative: true }),
      defRow({ key: '_messages', isNative: true }),
    ]);

    const result = await service.seedNativeProperties('channel-1');

    // Returns existing native defs, no inserts
    expect(result).toHaveLength(4);
    expect(db.__queries.insert).toHaveLength(0);
  });

  // ==================== findOrCreate ====================

  it('findOrCreate() returns existing definition if key exists', async () => {
    // findByKey returns existing
    db.__state.selectResults.push([defRow({ key: 'priority' })]);

    const result = await service.findOrCreate(
      'channel-1',
      'priority',
      'text',
      'user-1',
    );

    expect(result).toEqual(defRow({ key: 'priority' }));
    expect(db.__queries.insert).toHaveLength(0);
  });

  it('findOrCreate() creates new definition if key does not exist', async () => {
    // findByKey: no existing
    db.__state.selectResults.push([]);
    // getMaxOrder: no rows
    db.__state.selectResults.push([]);
    // insert returning
    db.__state.insertResults.push([defRow({ key: 'new-prop', id: 'uuid-1' })]);

    const result = await service.findOrCreate(
      'channel-1',
      'new-prop',
      'text',
      'user-1',
    );

    expect(result).toEqual(defRow({ key: 'new-prop', id: 'uuid-1' }));
    expect(db.__queries.insert).toHaveLength(1);
  });

  it('findOrCreate() throws when allowCreate=false and key does not exist', async () => {
    // findByKey: no existing
    db.__state.selectResults.push([]);

    await expect(
      service.findOrCreate('channel-1', 'missing', 'text', 'user-1', false),
    ).rejects.toThrow(BadRequestException);
  });
});
