import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NotFoundException, BadRequestException } from '@nestjs/common';

// ==================== Mock modules ====================

const dbModule = {
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  asc: jest.fn((value: unknown) => ({ op: 'asc', value })),
  inArray: jest.fn((left: unknown, right: unknown) => ({
    op: 'inArray',
    left,
    right,
  })),
};

const schemaModule = {
  channels: {
    id: 'channels.id',
    name: 'channels.name',
    description: 'channels.description',
  },
  messages: {
    id: 'messages.id',
    channelId: 'messages.channelId',
    content: 'messages.content',
    parentId: 'messages.parentId',
    isDeleted: 'messages.isDeleted',
    createdAt: 'messages.createdAt',
    senderId: 'messages.senderId',
  },
  messageReactions: {
    messageId: 'messageReactions.messageId',
    emoji: 'messageReactions.emoji',
  },
  users: {
    id: 'users.id',
    displayName: 'users.displayName',
    username: 'users.username',
  },
  channelPropertyDefinitions: {
    id: 'channelPropertyDefinitions.id',
  },
  messageProperties: {
    id: 'messageProperties.id',
    messageId: 'messageProperties.messageId',
  },
  auditLogs: {},
};

const mockGenerateText = jest.fn<any>();

jest.unstable_mockModule('@team9/database', () => dbModule);
jest.unstable_mockModule('@team9/database/schemas', () => schemaModule);
jest.unstable_mockModule('ai', () => ({
  generateText: mockGenerateText,
  tool: (config: any) => config,
  jsonSchema: (schema: any) => schema,
}));

const mockPlatformLlmService = {
  createProvider: jest.fn<any>(() => (modelId: string) => ({ modelId })),
};

jest.unstable_mockModule('../../bot/platform-llm.service.js', () => ({
  PlatformLlmService: jest.fn(() => mockPlatformLlmService),
}));

const mockPropertyDefinitionsService = {
  findAllByChannel: jest.fn<any>(),
};

const mockMessagePropertiesService = {
  getValidatedMessage: jest.fn<any>(),
  getProperties: jest.fn<any>(),
  batchSet: jest.fn<any>(),
};

const mockAuditService = {
  log: jest.fn<any>(),
};

jest.unstable_mockModule('./property-definitions.service.js', () => ({
  PropertyDefinitionsService: jest.fn(() => mockPropertyDefinitionsService),
}));

jest.unstable_mockModule('./message-properties.service.js', () => ({
  MessagePropertiesService: jest.fn(() => mockMessagePropertiesService),
}));

jest.unstable_mockModule('../audit/audit.service.js', () => ({
  AuditService: jest.fn(() => mockAuditService),
}));

const { AiAutoFillService } = await import('./ai-auto-fill.service.js');

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

describe('AiAutoFillService', () => {
  let service: InstanceType<typeof AiAutoFillService>;
  let db: ReturnType<typeof mockDb>;

  const now = new Date('2026-04-01T00:00:00Z');

  const baseMessage = {
    id: 'msg-1',
    channelId: 'channel-1',
    content: 'Fix the login bug on the auth page',
    type: 'text',
    isDeleted: false,
    parentId: null,
    senderId: 'user-1',
    createdAt: now,
    updatedAt: now,
  };

  const baseChannel = {
    id: 'channel-1',
    name: 'Engineering',
    description: 'Engineering discussions',
    type: 'public',
  };

  function propDef(overrides: Record<string, unknown> = {}) {
    return {
      id: 'def-status',
      channelId: 'channel-1',
      key: 'status',
      description: 'Task status',
      valueType: 'single_select',
      isNative: false,
      config: {
        options: [
          { value: 'open', label: 'Open' },
          { value: 'in_progress', label: 'In Progress' },
          { value: 'done', label: 'Done' },
        ],
      },
      order: 0,
      aiAutoFill: true,
      aiAutoFillPrompt: 'Determine the task status',
      isRequired: false,
      defaultValue: null,
      showInChatPolicy: 'show',
      allowNewOptions: false,
      createdBy: 'user-1',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function makeAiResponse(args: Record<string, unknown>) {
    return {
      toolCalls: [
        {
          toolName: 'set_message_properties',
          toolCallId: 'tool-1',
          args,
        },
      ],
    };
  }

  /** Set up the standard happy-path DB and mock state */
  function setupHappyPath(
    definitions: ReturnType<typeof propDef>[],
    aiInput: Record<string, unknown>,
    opts?: {
      currentProperties?: Record<string, unknown>;
      reactions?: Array<{ emoji: string; messageId: string }>;
      threadReplies?: Array<{
        content: string;
        senderId: string | null;
      }>;
      senders?: Array<{
        id: string;
        displayName: string | null;
        username: string;
      }>;
    },
  ) {
    mockMessagePropertiesService.getValidatedMessage.mockResolvedValue({
      message: baseMessage,
      channel: { type: 'public', propertySettings: null },
    });
    // Load channel
    db.__state.selectResults.push([baseChannel]);
    // Load definitions
    mockPropertyDefinitionsService.findAllByChannel.mockResolvedValue(
      definitions,
    );
    // Load current properties
    mockMessagePropertiesService.getProperties.mockResolvedValue(
      opts?.currentProperties ?? {},
    );
    // Load reactions
    db.__state.selectResults.push(opts?.reactions ?? []);
    // Load thread replies
    db.__state.selectResults.push(opts?.threadReplies ?? []);
    // Load senders (only if there are thread replies with senderIds)
    const senderIds = (opts?.threadReplies ?? [])
      .map((r) => r.senderId)
      .filter(Boolean);
    if (senderIds.length > 0) {
      db.__state.selectResults.push(
        opts?.senders ?? [
          { id: 'user-2', displayName: 'Alice', username: 'alice' },
        ],
      );
    }

    // AI response
    mockGenerateText.mockResolvedValue(makeAiResponse(aiInput));
    // batchSet
    mockMessagePropertiesService.batchSet.mockResolvedValue(undefined);
    // auditService.log
    mockAuditService.log.mockResolvedValue(undefined);
  }

  beforeEach(() => {
    db = mockDb();
    service = new AiAutoFillService(
      db as any,
      mockPlatformLlmService as any,
      mockPropertyDefinitionsService as any,
      mockMessagePropertiesService as any,
      mockAuditService as any,
    );
    jest.clearAllMocks();
  });

  // ==================== Core flow ====================

  it('builds correct XML prompt structure', async () => {
    const defs = [propDef()];
    setupHappyPath(defs, {
      status: { value: 'open' },
    });

    await service.autoFill('msg-1', 'user-1', 'tenant-1');

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    const callArgs = mockGenerateText.mock.calls[0][0];

    // Check that the user message contains XML structure
    const userMessage = callArgs.messages[0].content;
    expect(userMessage).toContain('<context>');
    expect(userMessage).toContain('<channel>');
    expect(userMessage).toContain('<name>Engineering</name>');
    expect(userMessage).toContain('<message>');
    expect(userMessage).toContain(
      '<content>Fix the login bug on the auth page</content>',
    );
    expect(userMessage).toContain('<channel_schema>');
    expect(userMessage).toContain('key="status"');
    expect(userMessage).toContain('type="single_select"');
    expect(userMessage).toContain('hint="Determine the task status"');
    expect(userMessage).toContain('<option>open</option>');
    expect(userMessage).toContain('</context>');
    expect(userMessage).toContain('<instructions>');
  });

  it('generates tool schema from property definitions', async () => {
    const defs = [
      propDef(),
      propDef({
        id: 'def-priority',
        key: 'priority',
        valueType: 'number',
        description: 'Priority level',
        config: null,
        aiAutoFillPrompt: null,
      }),
    ];
    setupHappyPath(defs, {
      status: { value: 'open' },
      priority: { value: 5 },
    });

    await service.autoFill('msg-1', 'user-1', 'tenant-1');

    const callArgs = mockGenerateText.mock.calls[0][0];
    const toolDef = callArgs.tools.set_message_properties;

    expect(toolDef.description).toBe(
      'Set property values for the message based on its content and context',
    );
    expect(toolDef.parameters.properties.status).toBeDefined();
    expect(toolDef.parameters.properties.priority).toBeDefined();
    expect(toolDef.parameters.required).toContain('status');
    expect(toolDef.parameters.required).toContain('priority');

    // status should have enum constraint (allowNewOptions=false)
    const statusValue = toolDef.parameters.properties.status.properties.value;
    expect(statusValue.enum).toEqual(['open', 'in_progress', 'done']);

    // priority should be number type
    const priorityValue =
      toolDef.parameters.properties.priority.properties.value;
    expect(priorityValue.type).toBe('number');
  });

  it('parses valid AI response correctly', async () => {
    const defs = [propDef()];
    setupHappyPath(defs, {
      status: { value: 'in_progress' },
    });

    const result = await service.autoFill('msg-1', 'user-1', 'tenant-1');

    expect(result.filled).toEqual({ status: 'in_progress' });
    expect(result.skipped).toEqual([]);
    expect(mockMessagePropertiesService.batchSet).toHaveBeenCalledWith(
      'msg-1',
      [{ key: 'status', value: 'in_progress' }],
      'user-1',
      { skipAudit: true },
    );
  });

  it('retries on validation failure (up to 3 rounds)', async () => {
    const defs = [propDef()];
    mockMessagePropertiesService.getValidatedMessage.mockResolvedValue({
      message: baseMessage,
      channel: { type: 'public', propertySettings: null },
    });
    db.__state.selectResults.push([baseChannel]); // channel
    mockPropertyDefinitionsService.findAllByChannel.mockResolvedValue(defs);
    mockMessagePropertiesService.getProperties.mockResolvedValue({});
    db.__state.selectResults.push([]); // reactions
    db.__state.selectResults.push([]); // thread replies

    // First attempt: invalid value (number instead of string for single_select)
    // Second attempt: also invalid
    // Third attempt: valid
    mockGenerateText
      .mockResolvedValueOnce(makeAiResponse({ status: { value: 123 } }))
      .mockResolvedValueOnce(makeAiResponse({ status: { value: 456 } }))
      .mockResolvedValueOnce(makeAiResponse({ status: { value: 'open' } }));

    // Need to reload channel/reactions/replies for retry rounds
    // The service only loads these once before the retry loop
    mockMessagePropertiesService.batchSet.mockResolvedValue(undefined);
    mockAuditService.log.mockResolvedValue(undefined);

    const result = await service.autoFill('msg-1', 'user-1', 'tenant-1');

    expect(mockGenerateText).toHaveBeenCalledTimes(3);
    expect(result.filled).toEqual({ status: 'open' });
  });

  it('respects fields parameter for selective generation', async () => {
    const defs = [
      propDef(),
      propDef({
        id: 'def-priority',
        key: 'priority',
        valueType: 'number',
        config: null,
      }),
    ];
    setupHappyPath(defs, { status: { value: 'done' } });

    await service.autoFill('msg-1', 'user-1', 'tenant-1', {
      fields: ['status'],
    });

    const callArgs = mockGenerateText.mock.calls[0][0];
    const userMessage = callArgs.messages[0].content;
    // Only status should appear in the schema, not priority
    expect(userMessage).toContain('key="status"');
    // The prompt should contain <generate_fields>
    expect(userMessage).toContain('<generate_fields>');
    expect(userMessage).toContain('<field>status</field>');
  });

  it('respects preserveExisting flag', async () => {
    const defs = [
      propDef(),
      propDef({
        id: 'def-priority',
        key: 'priority',
        valueType: 'number',
        config: null,
      }),
    ];

    mockMessagePropertiesService.getValidatedMessage.mockResolvedValue({
      message: baseMessage,
      channel: { type: 'public', propertySettings: null },
    });
    db.__state.selectResults.push([baseChannel]);
    mockPropertyDefinitionsService.findAllByChannel.mockResolvedValue(defs);
    // status already has a value
    mockMessagePropertiesService.getProperties.mockResolvedValue({
      status: 'open',
    });
    db.__state.selectResults.push([]); // reactions
    db.__state.selectResults.push([]); // thread replies

    mockGenerateText.mockResolvedValue(
      makeAiResponse({ priority: { value: 5 } }),
    );
    mockMessagePropertiesService.batchSet.mockResolvedValue(undefined);
    mockAuditService.log.mockResolvedValue(undefined);

    const result = await service.autoFill('msg-1', 'user-1', 'tenant-1', {
      preserveExisting: true,
    });

    // Only priority should have been filled since status already exists
    expect(result.filled).toEqual({ priority: 5 });
    expect(mockMessagePropertiesService.batchSet).toHaveBeenCalledWith(
      'msg-1',
      [{ key: 'priority', value: 5 }],
      'user-1',
      { skipAudit: true },
    );
  });

  it('records audit log with ai_auto_fill metadata', async () => {
    const defs = [propDef()];
    setupHappyPath(defs, { status: { value: 'done' } });

    await service.autoFill('msg-1', 'user-1', 'tenant-1');

    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel-1',
        entityType: 'message',
        entityId: 'msg-1',
        action: 'property_set',
        performedBy: undefined,
        metadata: expect.objectContaining({
          source: 'ai_auto_fill',
          model: 'claude-sonnet-4-20250514',
          round: 1,
        }),
      }),
    );
  });

  it('handles AI response with unchanged markers', async () => {
    const defs = [
      propDef(),
      propDef({
        id: 'def-priority',
        key: 'priority',
        valueType: 'number',
        config: null,
      }),
    ];
    setupHappyPath(defs, {
      status: { unchanged: true },
      priority: { value: 3 },
    });

    const result = await service.autoFill('msg-1', 'user-1', 'tenant-1');

    // status should be skipped (unchanged), only priority set
    expect(result.filled).toEqual({ priority: 3 });
    expect(mockMessagePropertiesService.batchSet).toHaveBeenCalledWith(
      'msg-1',
      [{ key: 'priority', value: 3 }],
      'user-1',
      { skipAudit: true },
    );
  });

  it('handles AI response with null values (skips them)', async () => {
    const defs = [propDef()];
    setupHappyPath(defs, {
      status: { value: null },
    });

    const result = await service.autoFill('msg-1', 'user-1', 'tenant-1');

    // null values are allowed but skipped in validateResult
    expect(result.filled).toEqual({});
    // batchSet should not be called if nothing to set
    expect(mockMessagePropertiesService.batchSet).not.toHaveBeenCalled();
  });

  it('fails gracefully after 3 failed rounds (AI errors)', async () => {
    const defs = [propDef()];
    mockMessagePropertiesService.getValidatedMessage.mockResolvedValue({
      message: baseMessage,
      channel: { type: 'public', propertySettings: null },
    });
    db.__state.selectResults.push([baseChannel]);
    mockPropertyDefinitionsService.findAllByChannel.mockResolvedValue(defs);
    mockMessagePropertiesService.getProperties.mockResolvedValue({});
    db.__state.selectResults.push([]); // reactions
    db.__state.selectResults.push([]); // thread replies

    mockGenerateText
      .mockRejectedValueOnce(new Error('API timeout'))
      .mockRejectedValueOnce(new Error('Rate limited'))
      .mockRejectedValueOnce(new Error('Server error'));

    await expect(
      service.autoFill('msg-1', 'user-1', 'tenant-1'),
    ).rejects.toThrow(BadRequestException);

    expect(mockGenerateText).toHaveBeenCalledTimes(3);
  });

  it('returns empty result when no definitions have aiAutoFill=true', async () => {
    mockMessagePropertiesService.getValidatedMessage.mockResolvedValue({
      message: baseMessage,
      channel: { type: 'public', propertySettings: null },
    });
    db.__state.selectResults.push([baseChannel]);
    mockPropertyDefinitionsService.findAllByChannel.mockResolvedValue([
      propDef({ aiAutoFill: false }),
    ]);

    const result = await service.autoFill('msg-1', 'user-1', 'tenant-1');

    expect(result).toEqual({ filled: {}, skipped: [] });
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('returns empty when all target definitions already have values and preserveExisting is true', async () => {
    mockMessagePropertiesService.getValidatedMessage.mockResolvedValue({
      message: baseMessage,
      channel: { type: 'public', propertySettings: null },
    });
    db.__state.selectResults.push([baseChannel]);
    mockPropertyDefinitionsService.findAllByChannel.mockResolvedValue([
      propDef(),
    ]);
    mockMessagePropertiesService.getProperties.mockResolvedValue({
      status: 'open',
    });

    const result = await service.autoFill('msg-1', 'user-1', 'tenant-1', {
      preserveExisting: true,
    });

    expect(result).toEqual({ filled: {}, skipped: [] });
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when channel is not found', async () => {
    mockMessagePropertiesService.getValidatedMessage.mockResolvedValue({
      message: baseMessage,
      channel: { type: 'public', propertySettings: null },
    });
    db.__state.selectResults.push([]); // channel not found

    await expect(
      service.autoFill('msg-1', 'user-1', 'tenant-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('filters out non-AI-fillable value types (e.g., date, file)', async () => {
    mockMessagePropertiesService.getValidatedMessage.mockResolvedValue({
      message: baseMessage,
      channel: { type: 'public', propertySettings: null },
    });
    db.__state.selectResults.push([baseChannel]);
    mockPropertyDefinitionsService.findAllByChannel.mockResolvedValue([
      propDef({ id: 'def-date', key: 'due_date', valueType: 'date' }),
      propDef({ id: 'def-file', key: 'attachment', valueType: 'file' }),
    ]);

    const result = await service.autoFill('msg-1', 'user-1', 'tenant-1');

    expect(result).toEqual({ filled: {}, skipped: [] });
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  // ==================== Tool schema generation ====================

  it('generates correct schema for text type', async () => {
    const defs = [
      propDef({
        key: 'summary',
        valueType: 'text',
        config: null,
      }),
    ];
    setupHappyPath(defs, { summary: { value: 'A bug fix' } });

    await service.autoFill('msg-1', 'user-1', 'tenant-1');

    const toolDef =
      mockGenerateText.mock.calls[0][0].tools.set_message_properties;
    const valueSchema = toolDef.parameters.properties.summary.properties.value;
    expect(valueSchema.type).toBe('string');
  });

  it('generates correct schema for boolean type', async () => {
    const defs = [
      propDef({
        key: 'urgent',
        valueType: 'boolean',
        config: null,
      }),
    ];
    setupHappyPath(defs, { urgent: { value: true } });

    await service.autoFill('msg-1', 'user-1', 'tenant-1');

    const toolDef =
      mockGenerateText.mock.calls[0][0].tools.set_message_properties;
    const valueSchema = toolDef.parameters.properties.urgent.properties.value;
    expect(valueSchema.type).toBe('boolean');
  });

  it('generates correct schema for multi_select with restricted options', async () => {
    const defs = [
      propDef({
        key: 'labels',
        valueType: 'multi_select',
        allowNewOptions: false,
        config: {
          options: [{ value: 'bug' }, { value: 'feature' }, { value: 'docs' }],
        },
      }),
    ];
    setupHappyPath(defs, { labels: { value: ['bug'] } });

    await service.autoFill('msg-1', 'user-1', 'tenant-1');

    const toolDef =
      mockGenerateText.mock.calls[0][0].tools.set_message_properties;
    const valueSchema = toolDef.parameters.properties.labels.properties.value;
    expect(valueSchema.type).toBe('array');
    expect(valueSchema.items.enum).toEqual(['bug', 'feature', 'docs']);
  });

  it('generates correct schema for tags with allowNewOptions', async () => {
    const defs = [
      propDef({
        key: 'tags',
        valueType: 'tags',
        allowNewOptions: true,
        config: { options: [{ value: 'v1' }] },
      }),
    ];
    setupHappyPath(defs, { tags: { value: ['v1', 'new-tag'] } });

    await service.autoFill('msg-1', 'user-1', 'tenant-1');

    const toolDef =
      mockGenerateText.mock.calls[0][0].tools.set_message_properties;
    const valueSchema = toolDef.parameters.properties.tags.properties.value;
    expect(valueSchema.type).toBe('array');
    // Should NOT have enum when allowNewOptions=true
    expect(valueSchema.items).toEqual({ type: 'string' });
  });

  it('generates correct schema for url type', async () => {
    const defs = [
      propDef({
        key: 'link',
        valueType: 'url',
        config: null,
      }),
    ];
    setupHappyPath(defs, {
      link: { value: 'https://example.com' },
    });

    await service.autoFill('msg-1', 'user-1', 'tenant-1');

    const toolDef =
      mockGenerateText.mock.calls[0][0].tools.set_message_properties;
    const valueSchema = toolDef.parameters.properties.link.properties.value;
    expect(valueSchema.type).toBe('string');
  });

  it('generates correct schema for person type', async () => {
    const defs = [
      propDef({
        key: 'assignees',
        valueType: 'person',
        config: null,
      }),
    ];
    setupHappyPath(defs, {
      assignees: { value: ['user-1'] },
    });

    await service.autoFill('msg-1', 'user-1', 'tenant-1');

    const toolDef =
      mockGenerateText.mock.calls[0][0].tools.set_message_properties;
    const valueSchema =
      toolDef.parameters.properties.assignees.properties.value;
    expect(valueSchema.type).toBe('array');
    expect(valueSchema.items).toEqual({ type: 'string' });
  });

  // ==================== Validation ====================

  it('rejects invalid single_select value not in options', async () => {
    const defs = [propDef()];
    mockMessagePropertiesService.getValidatedMessage.mockResolvedValue({
      message: baseMessage,
      channel: { type: 'public', propertySettings: null },
    });
    db.__state.selectResults.push([baseChannel]);
    mockPropertyDefinitionsService.findAllByChannel.mockResolvedValue(defs);
    mockMessagePropertiesService.getProperties.mockResolvedValue({});
    db.__state.selectResults.push([]); // reactions
    db.__state.selectResults.push([]); // thread replies

    // All 3 attempts return invalid option
    mockGenerateText.mockResolvedValue(
      makeAiResponse({ status: { value: 'invalid_option' } }),
    );

    mockMessagePropertiesService.batchSet.mockResolvedValue(undefined);
    mockAuditService.log.mockResolvedValue(undefined);

    // After 3 retries, the last attempt's invalid results should be in skipped
    const result = await service.autoFill('msg-1', 'user-1', 'tenant-1');
    expect(result.skipped).toContain('status');
  });

  it('rejects non-array value for multi_select', async () => {
    const defs = [
      propDef({
        key: 'labels',
        valueType: 'multi_select',
        config: { options: [{ value: 'bug' }] },
      }),
    ];
    mockMessagePropertiesService.getValidatedMessage.mockResolvedValue({
      message: baseMessage,
      channel: { type: 'public', propertySettings: null },
    });
    db.__state.selectResults.push([baseChannel]);
    mockPropertyDefinitionsService.findAllByChannel.mockResolvedValue(defs);
    mockMessagePropertiesService.getProperties.mockResolvedValue({});
    db.__state.selectResults.push([]);
    db.__state.selectResults.push([]);

    mockGenerateText.mockResolvedValue(
      makeAiResponse({ labels: { value: 'not-an-array' } }),
    );
    mockMessagePropertiesService.batchSet.mockResolvedValue(undefined);
    mockAuditService.log.mockResolvedValue(undefined);

    const result = await service.autoFill('msg-1', 'user-1', 'tenant-1');
    expect(result.skipped).toContain('labels');
  });

  // ==================== XML escaping ====================

  it('escapes XML special characters in prompt', async () => {
    const specialMessage = {
      ...baseMessage,
      content: 'Fix <script> & "quotes" in \'code\'',
    };
    const specialChannel = {
      ...baseChannel,
      name: 'Dev & <Ops>',
      description: 'A "special" channel',
    };

    mockMessagePropertiesService.getValidatedMessage.mockResolvedValue({
      message: specialMessage,
      channel: { type: 'public', propertySettings: null },
    });
    db.__state.selectResults.push([specialChannel]);
    mockPropertyDefinitionsService.findAllByChannel.mockResolvedValue([
      propDef(),
    ]);
    mockMessagePropertiesService.getProperties.mockResolvedValue({});
    db.__state.selectResults.push([]);
    db.__state.selectResults.push([]);
    mockGenerateText.mockResolvedValue(
      makeAiResponse({ status: { value: 'open' } }),
    );
    mockMessagePropertiesService.batchSet.mockResolvedValue(undefined);
    mockAuditService.log.mockResolvedValue(undefined);

    await service.autoFill('msg-1', 'user-1', 'tenant-1');

    const userMessage = mockGenerateText.mock.calls[0][0].messages[0].content;
    expect(userMessage).toContain('&lt;script&gt;');
    expect(userMessage).toContain('&amp;');
    expect(userMessage).toContain('&quot;quotes&quot;');
    expect(userMessage).toContain('&apos;code&apos;');
    expect(userMessage).toContain('Dev &amp; &lt;Ops&gt;');
  });

  // ==================== Thread replies and reactions in prompt ====================

  it('includes reactions and thread replies in prompt', async () => {
    const defs = [propDef()];
    mockMessagePropertiesService.getValidatedMessage.mockResolvedValue({
      message: baseMessage,
      channel: { type: 'public', propertySettings: null },
    });
    db.__state.selectResults.push([baseChannel]);
    mockPropertyDefinitionsService.findAllByChannel.mockResolvedValue(defs);
    mockMessagePropertiesService.getProperties.mockResolvedValue({});

    // Reactions
    db.__state.selectResults.push([
      { emoji: '👍', messageId: 'msg-1' },
      { emoji: '👍', messageId: 'msg-1' },
      { emoji: '🎉', messageId: 'msg-1' },
    ]);

    // Thread replies
    db.__state.selectResults.push([
      { content: 'I agree!', senderId: 'user-2' },
      { content: 'Me too', senderId: 'user-3' },
    ]);

    // Senders
    db.__state.selectResults.push([
      { id: 'user-2', displayName: 'Alice', username: 'alice' },
      { id: 'user-3', displayName: null, username: 'bob' },
    ]);

    mockGenerateText.mockResolvedValue(
      makeAiResponse({ status: { value: 'open' } }),
    );
    mockMessagePropertiesService.batchSet.mockResolvedValue(undefined);
    mockAuditService.log.mockResolvedValue(undefined);

    await service.autoFill('msg-1', 'user-1', 'tenant-1');

    const userMessage = mockGenerateText.mock.calls[0][0].messages[0].content;
    expect(userMessage).toContain('<reactions>');
    expect(userMessage).toMatch(/emoji="👍" count="2"/);
    expect(userMessage).toMatch(/emoji="🎉" count="1"/);
    expect(userMessage).toContain('<thread_replies>');
    expect(userMessage).toContain('sender="Alice"');
    expect(userMessage).toContain('I agree!');
  });

  // ==================== Retry prompt structure ====================

  it('includes error context in retry messages', async () => {
    const defs = [propDef()];
    mockMessagePropertiesService.getValidatedMessage.mockResolvedValue({
      message: baseMessage,
      channel: { type: 'public', propertySettings: null },
    });
    db.__state.selectResults.push([baseChannel]);
    mockPropertyDefinitionsService.findAllByChannel.mockResolvedValue(defs);
    mockMessagePropertiesService.getProperties.mockResolvedValue({});
    db.__state.selectResults.push([]);
    db.__state.selectResults.push([]);

    // First: invalid, second: valid
    mockGenerateText
      .mockResolvedValueOnce(makeAiResponse({ status: { value: 999 } }))
      .mockResolvedValueOnce(makeAiResponse({ status: { value: 'open' } }));

    mockMessagePropertiesService.batchSet.mockResolvedValue(undefined);
    mockAuditService.log.mockResolvedValue(undefined);

    await service.autoFill('msg-1', 'user-1', 'tenant-1');

    // Second call should have error context in messages
    const secondCallMessages = mockGenerateText.mock.calls[1][0].messages;
    expect(secondCallMessages.length).toBeGreaterThan(1);
    // Should include assistant message mentioning validation errors
    expect(secondCallMessages[1].content).toContain('validation errors');
  });

  // ==================== AI response missing tool_use block ====================

  it('throws when AI does not return a tool_use block', async () => {
    const defs = [propDef()];
    mockMessagePropertiesService.getValidatedMessage.mockResolvedValue({
      message: baseMessage,
      channel: { type: 'public', propertySettings: null },
    });
    db.__state.selectResults.push([baseChannel]);
    mockPropertyDefinitionsService.findAllByChannel.mockResolvedValue(defs);
    mockMessagePropertiesService.getProperties.mockResolvedValue({});
    db.__state.selectResults.push([]);
    db.__state.selectResults.push([]);

    mockGenerateText.mockResolvedValue({
      toolCalls: [],
    });

    await expect(
      service.autoFill('msg-1', 'user-1', 'tenant-1'),
    ).rejects.toThrow(BadRequestException);
  });
});
