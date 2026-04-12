import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';

const dbModule = {
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  inArray: jest.fn((col: unknown, vals: unknown[]) => ({
    op: 'inArray',
    col,
    vals,
  })),
};

const schemaModule = {
  messageProperties: {
    id: 'mp.id',
    messageId: 'mp.messageId',
    propertyDefinitionId: 'mp.propertyDefinitionId',
    textValue: 'mp.textValue',
    numberValue: 'mp.numberValue',
    booleanValue: 'mp.booleanValue',
    dateValue: 'mp.dateValue',
    jsonValue: 'mp.jsonValue',
    fileKey: 'mp.fileKey',
    fileMetadata: 'mp.fileMetadata',
    order: 'mp.order',
    createdBy: 'mp.createdBy',
    updatedBy: 'mp.updatedBy',
    createdAt: 'mp.createdAt',
    updatedAt: 'mp.updatedAt',
  },
  channelPropertyDefinitions: {
    id: 'cpd.id',
    channelId: 'cpd.channelId',
    key: 'cpd.key',
    showInChatPolicy: 'cpd.showInChatPolicy',
  },
  messages: {
    id: 'messages.id',
    channelId: 'messages.channelId',
    senderId: 'messages.senderId',
    parentId: 'messages.parentId',
    type: 'messages.type',
    isDeleted: 'messages.isDeleted',
  },
  channels: {
    id: 'channels.id',
    type: 'channels.type',
    propertySettings: 'channels.propertySettings',
  },
};

const WS_EVENTS_MOCK = {
  PROPERTY: { MESSAGE_CHANGED: 'property:message_changed' },
};

jest.unstable_mockModule('@team9/database', () => dbModule);
jest.unstable_mockModule('@team9/database/schemas', () => schemaModule);
jest.unstable_mockModule('@team9/shared', () => ({
  WS_EVENTS: WS_EVENTS_MOCK,
}));

// Mock the sibling services
const mockPropertyDefsService = {
  findByIdOrThrow: jest.fn<any>(),
  findOrCreate: jest.fn<any>(),
};

const mockAuditService = {
  log: jest.fn<any>(),
};

const mockWsGateway = {
  sendToChannelMembers: jest.fn<any>(),
};

jest.unstable_mockModule('./property-definitions.service.js', () => ({
  PropertyDefinitionsService: jest.fn(() => mockPropertyDefsService),
}));

jest.unstable_mockModule('../audit/audit.service.js', () => ({
  AuditService: jest.fn(() => mockAuditService),
}));

jest.unstable_mockModule('../websocket/websocket.gateway.js', () => ({
  WebsocketGateway: jest.fn(() => mockWsGateway),
}));

let uuidCounter = 0;
jest.unstable_mockModule('uuid', () => ({
  v7: jest.fn(() => `uuid-${++uuidCounter}`),
}));

const { MessagePropertiesService } =
  await import('./message-properties.service.js');

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

describe('MessagePropertiesService', () => {
  let service: InstanceType<typeof MessagePropertiesService>;
  let db: ReturnType<typeof mockDb>;

  const now = new Date('2026-04-01T00:00:00Z');

  function propRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'prop-1',
      messageId: 'msg-1',
      propertyDefinitionId: 'def-1',
      textValue: null,
      numberValue: null,
      booleanValue: null,
      dateValue: null,
      jsonValue: null,
      fileKey: null,
      fileMetadata: null,
      order: 0,
      createdBy: 'user-1',
      updatedBy: 'user-1',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function defRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'def-1',
      channelId: 'channel-1',
      key: 'priority',
      description: 'Priority',
      valueType: 'text',
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

  function messageRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'msg-1',
      channelId: 'channel-1',
      senderId: 'user-1',
      parentId: null,
      type: 'text',
      isDeleted: false,
      createdAt: now,
      ...overrides,
    };
  }

  beforeEach(() => {
    db = mockDb();
    service = new MessagePropertiesService(
      db as any,
      mockPropertyDefsService as any,
      mockAuditService as any,
      mockWsGateway as any,
    );
    uuidCounter = 0;
    jest.clearAllMocks();
    mockAuditService.log.mockResolvedValue(undefined);
    mockWsGateway.sendToChannelMembers.mockResolvedValue(undefined);
  });

  // ==================== getProperties ====================

  it('getProperties(messageId) returns properties as key-value map', async () => {
    // select from messageProperties
    db.__state.selectResults.push([
      propRow({ propertyDefinitionId: 'def-1', textValue: 'high' }),
    ]);
    // getDefinitionsByIds: select from channelPropertyDefinitions
    db.__state.selectResults.push([
      defRow({ id: 'def-1', key: 'priority', valueType: 'text' }),
    ]);

    const result = await service.getProperties('msg-1');

    expect(result).toEqual({ priority: 'high' });
  });

  // ==================== batchGetByMessageIds ====================

  it('batchGetByMessageIds() returns map of messageId to properties', async () => {
    db.__state.selectResults.push([
      propRow({
        messageId: 'msg-1',
        propertyDefinitionId: 'def-1',
        textValue: 'high',
      }),
      propRow({
        messageId: 'msg-2',
        propertyDefinitionId: 'def-1',
        textValue: 'low',
      }),
    ]);
    db.__state.selectResults.push([
      defRow({ id: 'def-1', key: 'priority', valueType: 'text' }),
    ]);

    const result = await service.batchGetByMessageIds(['msg-1', 'msg-2']);

    expect(result).toEqual({
      'msg-1': { priority: 'high' },
      'msg-2': { priority: 'low' },
    });
  });

  it('batchGetByMessageIds({ excludeHidden: true }) filters out hide policy', async () => {
    db.__state.selectResults.push([
      propRow({
        propertyDefinitionId: 'def-1',
        textValue: 'visible',
      }),
      propRow({
        propertyDefinitionId: 'def-2',
        numberValue: 42,
      }),
    ]);
    db.__state.selectResults.push([
      defRow({
        id: 'def-1',
        key: 'visible_prop',
        valueType: 'text',
        showInChatPolicy: 'auto',
      }),
      defRow({
        id: 'def-2',
        key: 'hidden_prop',
        valueType: 'number',
        showInChatPolicy: 'hide',
      }),
    ]);

    const result = await service.batchGetByMessageIds(['msg-1'], {
      excludeHidden: true,
    });

    expect(result).toEqual({
      'msg-1': { visible_prop: 'visible' },
    });
    // hidden_prop should NOT appear
    expect(result['msg-1']).not.toHaveProperty('hidden_prop');
  });

  // ==================== setProperty ====================

  it('setProperty() inserts new property with correct value column', async () => {
    // getValidatedMessage: message select
    db.__state.selectResults.push([messageRow()]);
    // getValidatedMessage: channel select
    db.__state.selectResults.push([{ type: 'public', propertySettings: null }]);

    mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
      defRow({ id: 'def-1', channelId: 'channel-1', valueType: 'text' }),
    );

    // findExisting: no existing
    db.__state.selectResults.push([]);
    // insert
    db.__state.insertResults.push([]);

    await service.setProperty('msg-1', 'def-1', 'high', 'user-1');

    expect(db.__queries.insert).toHaveLength(1);
    expect(db.__queries.insert[0].values).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-1',
        propertyDefinitionId: 'def-1',
        textValue: 'high',
        numberValue: null,
        booleanValue: null,
      }),
    );
    expect(mockAuditService.log).toHaveBeenCalled();
    expect(mockWsGateway.sendToChannelMembers).toHaveBeenCalled();
  });

  it('setProperty() updates existing property (upsert)', async () => {
    // getValidatedMessage: message select
    db.__state.selectResults.push([messageRow()]);
    // getValidatedMessage: channel select
    db.__state.selectResults.push([{ type: 'public', propertySettings: null }]);

    mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
      defRow({ id: 'def-1', channelId: 'channel-1', valueType: 'text' }),
    );

    // findExisting: existing property
    db.__state.selectResults.push([
      propRow({ id: 'existing-prop', textValue: 'low' }),
    ]);
    // update
    db.__state.updateResults.push([]);

    await service.setProperty('msg-1', 'def-1', 'high', 'user-1');

    expect(db.__queries.update).toHaveLength(1);
    expect(db.__queries.insert).toHaveLength(0);
    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'property_updated' }),
    );
  });

  it('setProperty() type validation: rejects string for number type', async () => {
    // getValidatedMessage
    db.__state.selectResults.push([messageRow()]);
    db.__state.selectResults.push([{ type: 'public', propertySettings: null }]);

    mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
      defRow({ id: 'def-1', channelId: 'channel-1', valueType: 'number' }),
    );

    await expect(
      service.setProperty('msg-1', 'def-1', 'not-a-number', 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('setProperty() type validation: rejects number for boolean type', async () => {
    db.__state.selectResults.push([messageRow()]);
    db.__state.selectResults.push([{ type: 'public', propertySettings: null }]);

    mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
      defRow({ id: 'def-1', channelId: 'channel-1', valueType: 'boolean' }),
    );

    await expect(
      service.setProperty('msg-1', 'def-1', 123, 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('setProperty() accepts falsy values: false, 0, empty string', async () => {
    // Test false for boolean
    db.__state.selectResults.push([messageRow()]);
    db.__state.selectResults.push([{ type: 'public', propertySettings: null }]);
    mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
      defRow({ id: 'def-1', channelId: 'channel-1', valueType: 'boolean' }),
    );
    db.__state.selectResults.push([]); // findExisting
    db.__state.insertResults.push([]); // insert

    await expect(
      service.setProperty('msg-1', 'def-1', false, 'user-1'),
    ).resolves.toBeUndefined();

    // Test 0 for number
    db.__state.selectResults.push([messageRow()]);
    db.__state.selectResults.push([{ type: 'public', propertySettings: null }]);
    mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
      defRow({ id: 'def-2', channelId: 'channel-1', valueType: 'number' }),
    );
    db.__state.selectResults.push([]);
    db.__state.insertResults.push([]);

    await expect(
      service.setProperty('msg-1', 'def-2', 0, 'user-1'),
    ).resolves.toBeUndefined();

    // Test empty string for text
    db.__state.selectResults.push([messageRow()]);
    db.__state.selectResults.push([{ type: 'public', propertySettings: null }]);
    mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
      defRow({ id: 'def-3', channelId: 'channel-1', valueType: 'text' }),
    );
    db.__state.selectResults.push([]);
    db.__state.insertResults.push([]);

    await expect(
      service.setProperty('msg-1', 'def-3', '', 'user-1'),
    ).resolves.toBeUndefined();
  });

  // ==================== removeProperty ====================

  it('removeProperty() deletes property and creates audit log', async () => {
    // getValidatedMessage
    db.__state.selectResults.push([messageRow()]);
    db.__state.selectResults.push([{ type: 'public', propertySettings: null }]);

    mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
      defRow({ id: 'def-1', channelId: 'channel-1', valueType: 'text' }),
    );

    // findExisting: existing property
    db.__state.selectResults.push([
      propRow({ id: 'prop-1', textValue: 'high' }),
    ]);
    // delete
    db.__state.deleteResults.push([]);

    await service.removeProperty('msg-1', 'def-1', 'user-1');

    expect(db.__queries.delete).toHaveLength(1);
    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'property_removed' }),
    );
    expect(mockWsGateway.sendToChannelMembers).toHaveBeenCalled();
  });

  // ==================== batchSet ====================

  it('batchSet() sets multiple properties, auto-creates definitions via findOrCreate', async () => {
    // getValidatedMessage: message select + channel select (now includes propertySettings)
    db.__state.selectResults.push([messageRow()]);
    db.__state.selectResults.push([{ type: 'public', propertySettings: {} }]);

    // Phase 1 (outside tx): findOrCreate for each property
    mockPropertyDefsService.findOrCreate.mockResolvedValueOnce(
      defRow({ id: 'def-1', key: 'priority', valueType: 'text' }),
    );
    mockPropertyDefsService.findOrCreate.mockResolvedValueOnce(
      defRow({ id: 'def-2', key: 'count', valueType: 'number' }),
    );

    // Phase 2 (inside tx): findExisting + insert for each property
    // Property 1: findExisting returns nothing, insert
    db.__state.selectResults.push([]); // findExisting via tx
    db.__state.insertResults.push([]); // insert via tx

    // Property 2: findExisting returns nothing, insert
    db.__state.selectResults.push([]); // findExisting via tx
    db.__state.insertResults.push([]); // insert via tx

    await service.batchSet(
      'msg-1',
      [
        { key: 'priority', value: 'high' },
        { key: 'count', value: 42 },
      ],
      'user-1',
    );

    expect(mockPropertyDefsService.findOrCreate).toHaveBeenCalledTimes(2);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(mockAuditService.log).toHaveBeenCalledTimes(2);
    expect(mockWsGateway.sendToChannelMembers).toHaveBeenCalledTimes(1);
  });

  it('batchSet() respects allowNonAdminCreateKey=false', async () => {
    // getValidatedMessage: channel select now includes propertySettings
    db.__state.selectResults.push([messageRow()]);
    db.__state.selectResults.push([
      { type: 'public', propertySettings: { allowNonAdminCreateKey: false } },
    ]);

    // Phase 1 (outside tx): findOrCreate should be called with allowCreate=false
    mockPropertyDefsService.findOrCreate.mockResolvedValueOnce(
      defRow({ id: 'def-1', key: 'existing', valueType: 'text' }),
    );

    // Phase 2 (inside tx): findExisting + insert
    db.__state.selectResults.push([]); // findExisting via tx
    db.__state.insertResults.push([]); // insert via tx

    await service.batchSet(
      'msg-1',
      [{ key: 'existing', value: 'val' }],
      'user-1',
    );

    expect(mockPropertyDefsService.findOrCreate).toHaveBeenCalledWith(
      'channel-1',
      'existing',
      'text',
      'user-1',
      false,
    );
  });

  // ==================== getValidatedMessage ====================

  it('getValidatedMessage() rejects thread replies (parentId not null)', async () => {
    db.__state.selectResults.push([messageRow({ parentId: 'parent-1' })]);

    await expect(service.getValidatedMessage('msg-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('getValidatedMessage() rejects system/tracking message types', async () => {
    db.__state.selectResults.push([messageRow({ type: 'system' })]);

    await expect(service.getValidatedMessage('msg-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('getValidatedMessage() rejects direct/task/tracking channel types', async () => {
    // Valid message
    db.__state.selectResults.push([messageRow()]);
    // Channel is 'direct' (not allowed)
    db.__state.selectResults.push([{ type: 'direct', propertySettings: null }]);

    await expect(service.getValidatedMessage('msg-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  // ==================== validateAndMapValue ====================

  it('validateAndMapValue() maps text type to textValue column', async () => {
    db.__state.selectResults.push([messageRow()]);
    db.__state.selectResults.push([{ type: 'public', propertySettings: null }]);
    mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
      defRow({ id: 'def-1', channelId: 'channel-1', valueType: 'text' }),
    );
    db.__state.selectResults.push([]);
    db.__state.insertResults.push([]);

    await service.setProperty('msg-1', 'def-1', 'hello', 'user-1');

    expect(db.__queries.insert[0].values).toHaveBeenCalledWith(
      expect.objectContaining({
        textValue: 'hello',
        numberValue: null,
        booleanValue: null,
        dateValue: null,
        jsonValue: null,
        fileKey: null,
        fileMetadata: null,
      }),
    );
  });

  it('validateAndMapValue() maps number type to numberValue column', async () => {
    db.__state.selectResults.push([messageRow()]);
    db.__state.selectResults.push([{ type: 'public', propertySettings: null }]);
    mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
      defRow({ id: 'def-2', channelId: 'channel-1', valueType: 'number' }),
    );
    db.__state.selectResults.push([]);
    db.__state.insertResults.push([]);

    await service.setProperty('msg-1', 'def-2', 42, 'user-1');

    expect(db.__queries.insert[0].values).toHaveBeenCalledWith(
      expect.objectContaining({
        textValue: null,
        numberValue: 42,
        booleanValue: null,
      }),
    );
  });

  it('validateAndMapValue() maps boolean type to booleanValue column', async () => {
    db.__state.selectResults.push([messageRow()]);
    db.__state.selectResults.push([{ type: 'public', propertySettings: null }]);
    mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
      defRow({ id: 'def-3', channelId: 'channel-1', valueType: 'boolean' }),
    );
    db.__state.selectResults.push([]);
    db.__state.insertResults.push([]);

    await service.setProperty('msg-1', 'def-3', true, 'user-1');

    expect(db.__queries.insert[0].values).toHaveBeenCalledWith(
      expect.objectContaining({
        textValue: null,
        numberValue: null,
        booleanValue: true,
      }),
    );
  });

  it('validateAndMapValue() maps multi_select type to jsonValue column', async () => {
    db.__state.selectResults.push([messageRow()]);
    db.__state.selectResults.push([{ type: 'public', propertySettings: null }]);
    mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
      defRow({
        id: 'def-4',
        channelId: 'channel-1',
        valueType: 'multi_select',
      }),
    );
    db.__state.selectResults.push([]);
    db.__state.insertResults.push([]);

    await service.setProperty('msg-1', 'def-4', ['a', 'b'], 'user-1');

    expect(db.__queries.insert[0].values).toHaveBeenCalledWith(
      expect.objectContaining({
        textValue: null,
        jsonValue: ['a', 'b'],
      }),
    );
  });
});
