import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ConflictException, BadRequestException } from '@nestjs/common';

const dbModule = {
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  asc: jest.fn((value: unknown) => ({ op: 'asc', value })),
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
  messageRelations: {
    propertyDefinitionId: 'mr.propertyDefinitionId',
  },
};

jest.unstable_mockModule('@team9/database', () => dbModule);
jest.unstable_mockModule('@team9/database/schemas', () => schemaModule);
jest.unstable_mockModule('@team9/shared', () => ({}));

let uuidCounter = 0;
jest.unstable_mockModule('uuid', () => ({
  v7: jest.fn(() => `uuid-${++uuidCounter}`),
}));

const { PropertyDefinitionsService } =
  await import('./property-definitions.service.js');
const { RelationError } = await import('./message-relations.errors.js');

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

  it('delete() deletes the definition', async () => {
    // findByIdOrThrow -> findById select
    db.__state.selectResults.push([defRow({ isNative: false })]);

    await service.delete('def-1');

    expect(db.__queries.delete).toHaveLength(1);
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

  // ==================== seedDefaultProperties ====================

  it('seedDefaultProperties() inserts status + priority on fresh channel', async () => {
    // findAllByChannel: no existing
    db.__state.selectResults.push([]);
    db.__state.insertResults.push([
      defRow({ key: 'status', id: 'uuid-1', order: 0 }),
      defRow({ key: 'priority', id: 'uuid-2', order: 1 }),
    ]);

    const result = await service.seedDefaultProperties('channel-1', 'user-1');

    expect(result).toHaveLength(2);
    expect(db.__queries.insert[0].values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'status',
          valueType: 'single_select',
          isNative: false,
          config: expect.objectContaining({
            options: expect.arrayContaining([
              expect.objectContaining({ value: 'todo' }),
              expect.objectContaining({ value: 'in_progress' }),
              expect.objectContaining({ value: 'done' }),
            ]),
          }),
        }),
        expect.objectContaining({
          key: 'priority',
          valueType: 'single_select',
          isNative: false,
          config: expect.objectContaining({
            options: expect.arrayContaining([
              expect.objectContaining({ value: 'low' }),
              expect.objectContaining({ value: 'medium' }),
              expect.objectContaining({ value: 'high' }),
            ]),
          }),
        }),
      ]),
    );
  });

  it('seedDefaultProperties() skips keys that already exist (idempotent)', async () => {
    // findAllByChannel: status already exists
    db.__state.selectResults.push([defRow({ key: 'status' })]);
    db.__state.insertResults.push([
      defRow({ key: 'priority', id: 'uuid-1', order: 1 }),
    ]);

    const result = await service.seedDefaultProperties('channel-1', 'user-1');

    expect(result).toHaveLength(1);
    expect(db.__queries.insert[0].values).toHaveBeenCalledWith([
      expect.objectContaining({ key: 'priority' }),
    ]);
  });

  it('seedDefaultProperties() is a no-op when both defaults already exist', async () => {
    db.__state.selectResults.push([
      defRow({ key: 'status' }),
      defRow({ key: 'priority' }),
    ]);

    const result = await service.seedDefaultProperties('channel-1', 'user-1');

    expect(result).toEqual([]);
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

  // ==================== relationKind config rules ====================

  describe('relationKind config rules', () => {
    it('rejects second parent definition on same channel', async () => {
      // findByKey: no duplicate key
      db.__state.selectResults.push([]);
      // parent conflict check: existing parent found
      db.__state.selectResults.push([{ id: 'existing-parent-def' }]);

      await expect(
        service.create(
          'channel-1',
          {
            key: 'parent2',
            valueType: 'message_ref',
            config: {
              relationKind: 'parent',
              scope: 'any',
              cardinality: 'single',
            },
          } as any,
          'user-1',
        ),
      ).rejects.toThrow(RelationError);

      // No insert should have been attempted
      expect(db.__queries.insert).toHaveLength(0);
    });

    it('allows multiple related definitions on same channel', async () => {
      // findByKey: no duplicate key
      db.__state.selectResults.push([]);
      // no parent conflict check needed for 'related' kind
      // getMaxOrder: existing rows
      db.__state.selectResults.push([{ order: 0 }]);
      // insert returning
      db.__state.insertResults.push([
        defRow({
          key: 'related2',
          valueType: 'message_ref',
          config: {
            scope: 'any',
            cardinality: 'multi',
            relationKind: 'related',
          },
        }),
      ]);

      const result = await service.create(
        'channel-1',
        {
          key: 'related2',
          valueType: 'message_ref',
          config: {
            relationKind: 'related',
            scope: 'any',
            cardinality: 'multi',
          },
        } as any,
        'user-1',
      );

      expect(result).toBeDefined();
      // No parent conflict query should have been fired
      expect(db.__queries.insert).toHaveLength(1);
    });

    it('applies default scope=any and cardinality=multi for legacy message_ref', async () => {
      // findByKey: no duplicate key
      db.__state.selectResults.push([]);
      // getMaxOrder: no rows
      db.__state.selectResults.push([]);
      // insert returning
      db.__state.insertResults.push([
        defRow({
          key: 'my-ref',
          valueType: 'message_ref',
          config: { scope: 'any', cardinality: 'multi' },
        }),
      ]);

      await service.create(
        'channel-1',
        { key: 'my-ref', valueType: 'message_ref' } as any,
        'user-1',
      );

      expect(db.__queries.insert[0].values).toHaveBeenCalledWith(
        expect.objectContaining({
          config: { scope: 'any', cardinality: 'multi' },
        }),
      );
    });

    it('preserves explicit scope/cardinality when provided', async () => {
      // findByKey: no duplicate key
      db.__state.selectResults.push([]);
      // getMaxOrder: no rows
      db.__state.selectResults.push([]);
      // insert returning
      db.__state.insertResults.push([
        defRow({
          key: 'scoped-ref',
          valueType: 'message_ref',
          config: { scope: 'same_channel', cardinality: 'single' },
        }),
      ]);

      await service.create(
        'channel-1',
        {
          key: 'scoped-ref',
          valueType: 'message_ref',
          config: { scope: 'same_channel', cardinality: 'single' },
        } as any,
        'user-1',
      );

      expect(db.__queries.insert[0].values).toHaveBeenCalledWith(
        expect.objectContaining({
          config: { scope: 'same_channel', cardinality: 'single' },
        }),
      );
    });

    it('rejects changing relationKind on a definition with existing edges (RelationError DEFINITION_IMMUTABLE)', async () => {
      // findByIdOrThrow -> findById: returns a message_ref def with 'related' kind
      db.__state.selectResults.push([
        defRow({
          valueType: 'message_ref',
          config: {
            scope: 'any',
            cardinality: 'multi',
            relationKind: 'related',
          },
        }),
      ]);
      // edge count query: 5 edges
      db.__state.selectResults.push([{ n: 5 }]);

      let caughtErr: unknown;
      try {
        await service.update('def-1', {
          config: {
            scope: 'any',
            cardinality: 'multi',
            relationKind: 'parent',
          },
        } as any);
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(RelationError);
      expect((caughtErr as InstanceType<typeof RelationError>).errorCode).toBe(
        'DEFINITION_IMMUTABLE',
      );
      // HTTP response body contains coded error
      const body = (
        caughtErr as InstanceType<typeof RelationError>
      ).getResponse() as Record<string, unknown>;
      expect(body.code).toBe('RELATION_DEFINITION_IMMUTABLE');

      expect(db.__queries.update).toHaveLength(0);
    });

    it('allows changing relationKind when no edges exist', async () => {
      // findByIdOrThrow -> findById: returns a message_ref def with 'related' kind
      db.__state.selectResults.push([
        defRow({
          valueType: 'message_ref',
          config: {
            scope: 'any',
            cardinality: 'multi',
            relationKind: 'related',
          },
        }),
      ]);
      // edge count query: 0 edges
      db.__state.selectResults.push([{ n: 0 }]);
      // parent conflict check: no existing parent
      db.__state.selectResults.push([]);
      // update returning
      db.__state.updateResults.push([
        defRow({
          valueType: 'message_ref',
          config: {
            scope: 'any',
            cardinality: 'multi',
            relationKind: 'parent',
          },
        }),
      ]);

      const result = await service.update('def-1', {
        config: { scope: 'any', cardinality: 'multi', relationKind: 'parent' },
      } as any);

      expect(result.config).toEqual({
        scope: 'any',
        cardinality: 'multi',
        relationKind: 'parent',
      });
      expect(db.__queries.update).toHaveLength(1);
    });

    it('rejects promoting a definition to parent when another parent already exists', async () => {
      // findByIdOrThrow -> findById: returns a message_ref def with 'related' kind
      db.__state.selectResults.push([
        defRow({
          valueType: 'message_ref',
          config: {
            scope: 'any',
            cardinality: 'multi',
            relationKind: 'related',
          },
        }),
      ]);
      // edge count query: 0 edges (change is otherwise allowed)
      db.__state.selectResults.push([{ n: 0 }]);
      // parent conflict check: existing parent found
      db.__state.selectResults.push([{ id: 'existing-parent-def' }]);

      await expect(
        service.update('def-1', {
          config: {
            scope: 'any',
            cardinality: 'multi',
            relationKind: 'parent',
          },
        } as any),
      ).rejects.toThrow(RelationError);

      expect(db.__queries.update).toHaveLength(0);
    });

    it('update() preserves current cardinality and relationKind when only scope is changed', async () => {
      // arrange: current def has { scope: 'any', cardinality: 'multi', relationKind: 'related' }
      db.__state.selectResults.push([
        defRow({
          valueType: 'message_ref',
          config: {
            scope: 'any',
            cardinality: 'multi',
            relationKind: 'related',
          },
        }),
      ]);
      // scope changed — triggers edge count check
      db.__state.selectResults.push([{ n: 0 }]);
      // no parent promotion, no conflict check needed for 'related' kind
      // update returning: stored config should be merged
      db.__state.updateResults.push([
        defRow({
          valueType: 'message_ref',
          config: {
            scope: 'same_channel',
            cardinality: 'multi',
            relationKind: 'related',
          },
        }),
      ]);

      await service.update('def-1', {
        config: { scope: 'same_channel' },
      } as any);

      // The update set must contain the fully merged config
      expect(db.__queries.update[0].set).toHaveBeenCalledWith(
        expect.objectContaining({
          config: {
            scope: 'same_channel',
            cardinality: 'multi',
            relationKind: 'related',
          },
        }),
      );
    });

    it('allows non-relationKind updates on message_ref definition without checking edges', async () => {
      // findByIdOrThrow -> findById: returns a message_ref def
      db.__state.selectResults.push([
        defRow({
          valueType: 'message_ref',
          config: {
            scope: 'any',
            cardinality: 'multi',
            relationKind: 'related',
          },
        }),
      ]);
      // update returning
      db.__state.updateResults.push([
        defRow({
          valueType: 'message_ref',
          config: {
            scope: 'any',
            cardinality: 'multi',
            relationKind: 'related',
          },
          description: 'Updated description',
        }),
      ]);

      const result = await service.update('def-1', {
        description: 'Updated description',
      } as any);

      expect(result.description).toBe('Updated description');
      // No edge count query should have been fired (only 1 select for findByIdOrThrow, 1 update)
      expect(db.__queries.select).toHaveLength(1);
      expect(db.__queries.update).toHaveLength(1);
    });
  });
});
