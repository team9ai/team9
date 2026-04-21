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
  isNull: jest.fn((col: unknown) => ({ op: 'isNull', col })),
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
  channelMembers: {
    role: 'cm.role',
    channelId: 'cm.channelId',
    userId: 'cm.userId',
    leftAt: 'cm.leftAt',
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

const mockRelationsService = {
  setRelationTargets: jest.fn<any>(),
  getOutgoingTargets: jest.fn<any>(),
  getOutgoingTargetsForMany: jest.fn<any>(),
  getEffectiveParent: jest.fn<any>(),
  getIncomingSources: jest.fn<any>(),
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

jest.unstable_mockModule('./message-relations.service.js', () => ({
  MessageRelationsService: jest.fn(() => mockRelationsService),
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
    const mockModuleRef = { get: jest.fn().mockReturnValue(mockWsGateway) };
    service = new MessagePropertiesService(
      db as any,
      mockPropertyDefsService as any,
      mockAuditService as any,
      mockRelationsService as any,
      mockModuleRef as any,
    );
    uuidCounter = 0;
    jest.clearAllMocks();
    mockAuditService.log.mockResolvedValue(undefined);
    mockWsGateway.sendToChannelMembers.mockResolvedValue(undefined);
    mockRelationsService.setRelationTargets.mockResolvedValue({
      addedTargetIds: [],
      removedTargetIds: [],
      currentTargetIds: [],
    });
    mockRelationsService.getOutgoingTargets.mockResolvedValue([]);
    mockRelationsService.getOutgoingTargetsForMany.mockResolvedValue(new Map());
    mockRelationsService.getEffectiveParent.mockResolvedValue(null);
    mockRelationsService.getIncomingSources.mockResolvedValue([]);
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

  it('getProperties({ excludeHidden: true }) filters out hide policy', async () => {
    db.__state.selectResults.push([
      propRow({ propertyDefinitionId: 'def-1', textValue: 'visible' }),
      propRow({
        id: 'prop-2',
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

    const result = await service.getProperties('msg-1', {
      excludeHidden: true,
    });

    expect(result).toEqual({ visible_prop: 'visible' });
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

  it('removeProperty() throws NotFoundException when property does not exist', async () => {
    // getValidatedMessage
    db.__state.selectResults.push([messageRow()]);
    db.__state.selectResults.push([{ type: 'public', propertySettings: null }]);

    mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
      defRow({ id: 'def-1', channelId: 'channel-1', valueType: 'text' }),
    );

    // findExisting: no existing property
    db.__state.selectResults.push([]);

    await expect(
      service.removeProperty('msg-1', 'def-1', 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });

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
    // getValidatedMessage: message select + channel select (with propertySettings)
    db.__state.selectResults.push([messageRow()]);
    db.__state.selectResults.push([
      { type: 'public', propertySettings: { allowNonAdminCreateKey: false } },
    ]);

    // Membership check: user is a regular member (not admin/owner)
    db.__state.selectResults.push([{ role: 'member' }]);

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

  it('getValidatedMessage() throws NotFoundException when message not found', async () => {
    db.__state.selectResults.push([]); // no message found

    await expect(
      service.getValidatedMessage('msg-nonexistent'),
    ).rejects.toThrow(NotFoundException);
  });

  it('getValidatedMessage() throws NotFoundException when message isDeleted', async () => {
    db.__state.selectResults.push([messageRow({ isDeleted: true })]);

    await expect(service.getValidatedMessage('msg-1')).rejects.toThrow(
      NotFoundException,
    );
  });

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

  // ==================== getMessageChannelId ====================

  it('getMessageChannelId() returns channelId for non-deleted message', async () => {
    db.__state.selectResults.push([
      { channelId: 'channel-1', isDeleted: false },
    ]);

    const result = await service.getMessageChannelId('msg-1');
    expect(result).toBe('channel-1');
  });

  it('getMessageChannelId() throws NotFoundException for soft-deleted message', async () => {
    db.__state.selectResults.push([
      { channelId: 'channel-1', isDeleted: true },
    ]);

    await expect(service.getMessageChannelId('msg-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('getMessageChannelId() throws NotFoundException for missing message', async () => {
    db.__state.selectResults.push([]);

    await expect(service.getMessageChannelId('missing')).rejects.toThrow(
      NotFoundException,
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

  // ==================== relationKind property routing ====================

  function relKindDefRow(overrides: Record<string, unknown> = {}) {
    return defRow({
      id: 'def-rel',
      channelId: 'channel-1',
      key: 'parent',
      valueType: 'message_ref',
      config: {
        scope: 'same_channel',
        cardinality: 'single',
        relationKind: 'parent',
      },
      ...overrides,
    });
  }

  describe('relationKind property routing', () => {
    it('delegates writes to MessageRelationsService.setRelationTargets', async () => {
      db.__state.selectResults.push([messageRow()]);
      db.__state.selectResults.push([
        { type: 'public', propertySettings: null },
      ]);
      mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
        relKindDefRow(),
      );
      // findExisting: no row
      db.__state.selectResults.push([]);
      // insert sentinel
      db.__state.insertResults.push([]);

      mockRelationsService.setRelationTargets.mockResolvedValue({
        addedTargetIds: ['target-1'],
        removedTargetIds: [],
        currentTargetIds: ['target-1'],
      });

      await service.setProperty('msg-1', 'def-rel', 'target-1', 'user-1');

      expect(mockRelationsService.setRelationTargets).toHaveBeenCalledWith(
        {
          sourceMessageId: 'msg-1',
          targetMessageIds: ['target-1'],
          definition: {
            id: 'def-rel',
            channelId: 'channel-1',
            config: {
              scope: 'same_channel',
              cardinality: 'single',
              relationKind: 'parent',
            },
          },
          actorId: 'user-1',
        },
        db, // outer tx passed through
      );
    });

    it('sets explicitlyCleared=true on jsonValue when value is null', async () => {
      db.__state.selectResults.push([messageRow()]);
      db.__state.selectResults.push([
        { type: 'public', propertySettings: null },
      ]);
      mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
        relKindDefRow(),
      );
      // findExisting: no row
      db.__state.selectResults.push([]);
      // insert sentinel
      db.__state.insertResults.push([]);

      mockRelationsService.setRelationTargets.mockResolvedValue({
        addedTargetIds: [],
        removedTargetIds: [],
        currentTargetIds: [],
      });

      await service.setProperty('msg-1', 'def-rel', null, 'user-1');

      expect(db.__queries.insert[0].values).toHaveBeenCalledWith(
        expect.objectContaining({
          jsonValue: { explicitlyCleared: true },
        }),
      );
    });

    it('updates sentinel row when existing row is present', async () => {
      db.__state.selectResults.push([messageRow()]);
      db.__state.selectResults.push([
        { type: 'public', propertySettings: null },
      ]);
      mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
        relKindDefRow(),
      );
      // findExisting: existing row
      db.__state.selectResults.push([
        propRow({ id: 'existing-sentinel', jsonValue: null }),
      ]);
      // update
      db.__state.updateResults.push([]);

      mockRelationsService.setRelationTargets.mockResolvedValue({
        addedTargetIds: ['target-2'],
        removedTargetIds: ['target-1'],
        currentTargetIds: ['target-2'],
      });

      await service.setProperty('msg-1', 'def-rel', 'target-2', 'user-1');

      expect(db.__queries.update).toHaveLength(1);
      expect(db.__queries.update[0].set).toHaveBeenCalledWith(
        expect.objectContaining({ jsonValue: null }),
      );
      expect(db.__queries.insert).toHaveLength(0);
    });

    it('returns multi-cardinality target ids array on read', async () => {
      // getProperties: select messageProperties rows
      db.__state.selectResults.push([
        propRow({
          propertyDefinitionId: 'def-rel',
          jsonValue: null, // sentinel null = has targets
        }),
      ]);
      // getDefinitionsByIds
      db.__state.selectResults.push([
        relKindDefRow({
          config: {
            scope: 'same_channel',
            cardinality: 'multi',
            relationKind: 'parent',
          },
        }),
      ]);

      mockRelationsService.getOutgoingTargets.mockResolvedValue([
        'target-1',
        'target-2',
      ]);

      const result = await service.getProperties('msg-1');

      expect(mockRelationsService.getOutgoingTargets).toHaveBeenCalledWith(
        'msg-1',
        'def-rel',
      );
      expect(result['parent']).toEqual(['target-1', 'target-2']);
    });

    it('returns single target id for single-cardinality on read', async () => {
      db.__state.selectResults.push([
        propRow({ propertyDefinitionId: 'def-rel', jsonValue: null }),
      ]);
      db.__state.selectResults.push([relKindDefRow()]);

      mockRelationsService.getOutgoingTargets.mockResolvedValue(['target-1']);

      const result = await service.getProperties('msg-1');

      expect(result['parent']).toBe('target-1');
    });

    it('returns null on read when explicitlyCleared=true (single cardinality)', async () => {
      db.__state.selectResults.push([
        propRow({
          propertyDefinitionId: 'def-rel',
          jsonValue: { explicitlyCleared: true },
        }),
      ]);
      db.__state.selectResults.push([relKindDefRow()]);

      const result = await service.getProperties('msg-1');

      expect(mockRelationsService.getOutgoingTargets).not.toHaveBeenCalled();
      expect(result['parent']).toBeNull();
    });

    it('returns empty array on read when explicitlyCleared=true (multi cardinality)', async () => {
      db.__state.selectResults.push([
        propRow({
          propertyDefinitionId: 'def-rel',
          jsonValue: { explicitlyCleared: true },
        }),
      ]);
      db.__state.selectResults.push([
        relKindDefRow({
          config: {
            scope: 'same_channel',
            cardinality: 'multi',
            relationKind: 'parent',
          },
        }),
      ]);

      const result = await service.getProperties('msg-1');

      expect(mockRelationsService.getOutgoingTargets).not.toHaveBeenCalled();
      expect(result['parent']).toEqual([]);
    });

    it('returns null when no targets found for single-cardinality on read', async () => {
      db.__state.selectResults.push([
        propRow({ propertyDefinitionId: 'def-rel', jsonValue: null }),
      ]);
      db.__state.selectResults.push([relKindDefRow()]);

      mockRelationsService.getOutgoingTargets.mockResolvedValue([]);

      const result = await service.getProperties('msg-1');

      expect(result['parent']).toBeNull();
    });

    it('legacy message_ref (no relationKind) still writes jsonValue', async () => {
      // A message_ref property without relationKind should use the legacy jsonValue path
      db.__state.selectResults.push([messageRow()]);
      db.__state.selectResults.push([
        { type: 'public', propertySettings: null },
      ]);
      mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
        defRow({
          id: 'def-legacy',
          channelId: 'channel-1',
          valueType: 'message_ref',
          config: { scope: 'any', cardinality: 'multi' }, // no relationKind
        }),
      );
      db.__state.selectResults.push([]);
      db.__state.insertResults.push([]);

      const legacyValue = ['msg-ref-1', 'msg-ref-2'];
      await service.setProperty('msg-1', 'def-legacy', legacyValue, 'user-1');

      // Should NOT call relationsService
      expect(mockRelationsService.setRelationTargets).not.toHaveBeenCalled();
      // Should write jsonValue directly
      expect(db.__queries.insert[0].values).toHaveBeenCalledWith(
        expect.objectContaining({
          jsonValue: legacyValue,
        }),
      );
    });

    it('audit log carries addedTargetIds and removedTargetIds on relation write', async () => {
      db.__state.selectResults.push([messageRow()]);
      db.__state.selectResults.push([
        { type: 'public', propertySettings: null },
      ]);
      mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
        relKindDefRow(),
      );
      db.__state.selectResults.push([]);
      db.__state.insertResults.push([]);

      mockRelationsService.setRelationTargets.mockResolvedValue({
        addedTargetIds: ['new-target'],
        removedTargetIds: ['old-target'],
        currentTargetIds: ['new-target'],
      });

      await service.setProperty('msg-1', 'def-rel', 'new-target', 'user-1');

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: {
            parent: {
              added: ['new-target'],
              removed: ['old-target'],
            },
          },
          metadata: expect.objectContaining({
            relationKind: 'parent',
            valueType: 'message_ref',
          }),
        }),
      );
    });

    it('audit log marks explicitlyCleared in metadata when value=null', async () => {
      db.__state.selectResults.push([messageRow()]);
      db.__state.selectResults.push([
        { type: 'public', propertySettings: null },
      ]);
      mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
        relKindDefRow(),
      );
      db.__state.selectResults.push([]);
      db.__state.insertResults.push([]);

      mockRelationsService.setRelationTargets.mockResolvedValue({
        addedTargetIds: [],
        removedTargetIds: ['old-target'],
        currentTargetIds: [],
      });

      await service.setProperty('msg-1', 'def-rel', null, 'user-1');

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'property_removed',
          metadata: expect.objectContaining({
            explicitlyCleared: true,
            relationKind: 'parent',
          }),
        }),
      );
    });

    it('wraps setRelationTargets + sentinel upsert in a single outer transaction (atomicity)', async () => {
      db.__state.selectResults.push([messageRow()]);
      db.__state.selectResults.push([
        { type: 'public', propertySettings: null },
      ]);
      mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
        relKindDefRow(),
      );
      // Inside tx: findExisting (no row)
      db.__state.selectResults.push([]);
      // Inside tx: insert sentinel
      db.__state.insertResults.push([]);

      mockRelationsService.setRelationTargets.mockResolvedValue({
        addedTargetIds: ['target-1'],
        removedTargetIds: [],
        currentTargetIds: ['target-1'],
      });

      const txSpy = jest.spyOn(db, 'transaction');

      await service.setProperty('msg-1', 'def-rel', 'target-1', 'user-1');

      // Exactly one outer transaction wraps both the relation write and sentinel upsert
      expect(txSpy).toHaveBeenCalledTimes(1);
      // setRelationTargets received the outer tx (= db in mock)
      expect(mockRelationsService.setRelationTargets).toHaveBeenCalledWith(
        expect.anything(),
        db,
      );
    });

    it('batchGetByMessageIds uses getOutgoingTargetsForMany (single batch call, not N+1)', async () => {
      // Two relation-kind property rows for two different messages
      db.__state.selectResults.push([
        {
          ...propRow({
            messageId: 'msg-1',
            propertyDefinitionId: 'def-rel',
            jsonValue: null,
          }),
        },
        {
          ...propRow({
            id: 'prop-2',
            messageId: 'msg-2',
            propertyDefinitionId: 'def-rel',
            jsonValue: null,
          }),
        },
      ]);
      db.__state.selectResults.push([
        relKindDefRow({
          config: {
            scope: 'same_channel',
            cardinality: 'multi',
            relationKind: 'parent',
          },
        }),
      ]);

      mockRelationsService.getOutgoingTargetsForMany.mockResolvedValue(
        new Map([
          ['msg-1', ['target-a']],
          ['msg-2', ['target-b', 'target-c']],
        ]),
      );

      const result = await service.batchGetByMessageIds(['msg-1', 'msg-2']);

      // One batch call, not two individual calls
      expect(
        mockRelationsService.getOutgoingTargetsForMany,
      ).toHaveBeenCalledTimes(1);
      expect(mockRelationsService.getOutgoingTargets).not.toHaveBeenCalled();
      expect(result['msg-1']['parent']).toEqual(['target-a']);
      expect(result['msg-2']['parent']).toEqual(['target-b', 'target-c']);
    });

    it('batchGetByMessageIds handles explicitlyCleared sentinel in batch path', async () => {
      db.__state.selectResults.push([
        propRow({
          messageId: 'msg-1',
          propertyDefinitionId: 'def-rel',
          jsonValue: { explicitlyCleared: true },
        }),
      ]);
      db.__state.selectResults.push([relKindDefRow()]);

      mockRelationsService.getOutgoingTargetsForMany.mockResolvedValue(
        new Map([['msg-1', []]]),
      );

      const result = await service.batchGetByMessageIds(['msg-1']);

      // explicitlyCleared=true → single cardinality → null (batch result not used for cleared rows)
      expect(result['msg-1']['parent']).toBeNull();
      // getOutgoingTargetsForMany is still called (prefetch is eager); result just ignored for cleared rows
      expect(
        mockRelationsService.getOutgoingTargetsForMany,
      ).toHaveBeenCalledTimes(1);
    });

    it('removeProperty for relationKind triggers relation removal + explicitlyCleared', async () => {
      db.__state.selectResults.push([messageRow()]);
      db.__state.selectResults.push([
        { type: 'public', propertySettings: null },
      ]);
      mockPropertyDefsService.findByIdOrThrow.mockResolvedValue(
        relKindDefRow(),
      );
      // findExisting: existing sentinel row
      db.__state.selectResults.push([]);
      // insert after clear
      db.__state.insertResults.push([]);

      mockRelationsService.setRelationTargets.mockResolvedValue({
        addedTargetIds: [],
        removedTargetIds: ['old-target'],
        currentTargetIds: [],
      });

      await service.removeProperty('msg-1', 'def-rel', 'user-1');

      expect(mockRelationsService.setRelationTargets).toHaveBeenCalledWith(
        expect.objectContaining({ targetMessageIds: [] }),
        db, // outer tx passed through
      );
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ explicitlyCleared: true }),
        }),
      );
    });
  });

  // ==================== getRelationsInspection ====================

  describe('getRelationsInspection', () => {
    it('returns empty result when message does not exist', async () => {
      // messages select → no row
      db.__state.selectResults.push([]);

      const result = await service.getRelationsInspection('nonexistent-msg');

      expect(result).toEqual({
        outgoing: { parent: [], related: [] },
        incoming: { children: [], relatedBy: [] },
      });
    });

    it('returns empty result when channel has no definitions', async () => {
      // messages select → found
      db.__state.selectResults.push([{ channelId: 'channel-1' }]);
      // channelPropertyDefinitions select → empty
      db.__state.selectResults.push([]);

      const result = await service.getRelationsInspection('msg-1');

      expect(result).toEqual({
        outgoing: { parent: [], related: [] },
        incoming: { children: [], relatedBy: [] },
      });
    });

    it('walks parent chain to depth N for outgoing parent', async () => {
      // messages select → found
      db.__state.selectResults.push([{ channelId: 'channel-1' }]);
      // channelPropertyDefinitions → one parent-kind def
      db.__state.selectResults.push([
        { id: 'parent-def', config: { relationKind: 'parent' } },
      ]);

      // Walk: msg-1 → parent-a (depth 1) → parent-b (depth 2) → null (stop)
      mockRelationsService.getEffectiveParent
        .mockResolvedValueOnce({ id: 'parent-a', source: 'relation' })
        .mockResolvedValueOnce({ id: 'parent-b', source: 'thread' })
        .mockResolvedValueOnce(null);
      // No incoming calls (direction=both but kind=parent skips related incoming)
      mockRelationsService.getIncomingSources.mockResolvedValue([]);

      const result = await service.getRelationsInspection('msg-1', {
        kind: 'parent',
        direction: 'outgoing',
        depth: 2,
      });

      expect(result.outgoing.parent).toEqual([
        {
          messageId: 'parent-a',
          depth: 1,
          propertyDefinitionId: 'parent-def',
          parentSource: 'relation',
        },
        {
          messageId: 'parent-b',
          depth: 2,
          propertyDefinitionId: 'parent-def',
          parentSource: 'thread',
        },
      ]);
      expect(result.outgoing.related).toEqual([]);
      expect(result.incoming.children).toEqual([]);
    });

    it('collects incoming children for parent-kind definitions', async () => {
      // messages select → found
      db.__state.selectResults.push([{ channelId: 'channel-1' }]);
      // channelPropertyDefinitions → parent def only
      db.__state.selectResults.push([
        { id: 'parent-def', config: { relationKind: 'parent' } },
      ]);

      // No outgoing parent
      mockRelationsService.getEffectiveParent.mockResolvedValue(null);
      // Incoming children
      mockRelationsService.getIncomingSources.mockResolvedValue([
        { sourceMessageId: 'child-1', propertyDefinitionId: 'parent-def' },
        { sourceMessageId: 'child-2', propertyDefinitionId: 'parent-def' },
      ]);

      const result = await service.getRelationsInspection('msg-1', {
        kind: 'parent',
        direction: 'incoming',
      });

      expect(result.incoming.children).toEqual([
        {
          messageId: 'child-1',
          depth: 1,
          propertyDefinitionId: 'parent-def',
          parentSource: 'relation',
        },
        {
          messageId: 'child-2',
          depth: 1,
          propertyDefinitionId: 'parent-def',
          parentSource: 'relation',
        },
      ]);
      expect(result.outgoing.parent).toEqual([]);
    });

    it('collects outgoing related targets and incoming relatedBy', async () => {
      // messages select → found
      db.__state.selectResults.push([{ channelId: 'channel-1' }]);
      // channelPropertyDefinitions → one related-kind def
      db.__state.selectResults.push([
        { id: 'related-def', config: { relationKind: 'related' } },
      ]);

      // Outgoing targets
      mockRelationsService.getOutgoingTargets.mockResolvedValue([
        'target-1',
        'target-2',
      ]);
      // Incoming relatedBy
      mockRelationsService.getIncomingSources.mockResolvedValue([
        { sourceMessageId: 'source-1', propertyDefinitionId: 'related-def' },
      ]);

      const result = await service.getRelationsInspection('msg-1', {
        kind: 'related',
        direction: 'both',
      });

      expect(result.outgoing.related).toEqual([
        { messageId: 'target-1', propertyDefinitionId: 'related-def' },
        { messageId: 'target-2', propertyDefinitionId: 'related-def' },
      ]);
      expect(result.incoming.relatedBy).toEqual([
        { messageId: 'source-1', propertyDefinitionId: 'related-def' },
      ]);
      expect(result.outgoing.parent).toEqual([]);
      expect(result.incoming.children).toEqual([]);
    });

    it('filters by kind=parent (skips related defs)', async () => {
      // messages select → found
      db.__state.selectResults.push([{ channelId: 'channel-1' }]);
      // channelPropertyDefinitions → both parent and related defs
      db.__state.selectResults.push([
        { id: 'parent-def', config: { relationKind: 'parent' } },
        { id: 'related-def', config: { relationKind: 'related' } },
      ]);

      mockRelationsService.getEffectiveParent.mockResolvedValue(null);
      mockRelationsService.getIncomingSources.mockResolvedValue([]);

      const result = await service.getRelationsInspection('msg-1', {
        kind: 'parent',
        direction: 'both',
      });

      // getOutgoingTargets should NOT be called (related kind is skipped)
      expect(mockRelationsService.getOutgoingTargets).not.toHaveBeenCalled();
      expect(result.outgoing.related).toEqual([]);
      expect(result.incoming.relatedBy).toEqual([]);
    });

    it('filters by direction=outgoing (skips incoming lookups)', async () => {
      // messages select → found
      db.__state.selectResults.push([{ channelId: 'channel-1' }]);
      // channelPropertyDefinitions → parent def
      db.__state.selectResults.push([
        { id: 'parent-def', config: { relationKind: 'parent' } },
      ]);

      mockRelationsService.getEffectiveParent.mockResolvedValue(null);

      const result = await service.getRelationsInspection('msg-1', {
        kind: 'all',
        direction: 'outgoing',
      });

      expect(mockRelationsService.getIncomingSources).not.toHaveBeenCalled();
      expect(result.incoming.children).toEqual([]);
      expect(result.incoming.relatedBy).toEqual([]);
    });

    it('clamps depth to minimum 1', async () => {
      // messages select → found
      db.__state.selectResults.push([{ channelId: 'channel-1' }]);
      // channelPropertyDefinitions → parent def
      db.__state.selectResults.push([
        { id: 'parent-def', config: { relationKind: 'parent' } },
      ]);

      // With depth=0 (clamped to 1), getEffectiveParent should still be called once
      mockRelationsService.getEffectiveParent.mockResolvedValue(null);
      mockRelationsService.getIncomingSources.mockResolvedValue([]);

      await service.getRelationsInspection('msg-1', { depth: 0 });

      // depth clamped to 1, so getEffectiveParent called exactly once
      expect(mockRelationsService.getEffectiveParent).toHaveBeenCalledTimes(1);
    });

    it('clamps depth to maximum 10', async () => {
      // messages select → found
      db.__state.selectResults.push([{ channelId: 'channel-1' }]);
      // channelPropertyDefinitions → parent def
      db.__state.selectResults.push([
        { id: 'parent-def', config: { relationKind: 'parent' } },
      ]);

      // With depth=100 (clamped to 10), chain has 5 entries then null
      let callCount = 0;
      const parentIds = ['p1', 'p2', 'p3', 'p4', 'p5'];
      mockRelationsService.getEffectiveParent.mockImplementation(async () => {
        const id = parentIds[callCount];
        callCount++;
        return id ? { id, source: 'relation' as const } : null;
      });
      mockRelationsService.getIncomingSources.mockResolvedValue([]);

      const result = await service.getRelationsInspection('msg-1', {
        depth: 100,
        kind: 'parent',
        direction: 'outgoing',
      });

      // Even with depth=100, clamped to 10. Chain stops at 5 entries (returns null).
      expect(result.outgoing.parent).toHaveLength(5);
      // Confirm no call was made beyond the chain length
      expect(mockRelationsService.getEffectiveParent).toHaveBeenCalledTimes(6); // 5 parent + 1 null
    });
  });
});
