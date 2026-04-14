import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { DATABASE_CONNECTION } from '@team9/database';
import { RabbitMQEventService } from '@team9/rabbitmq';
import { ClawHiveService } from '@team9/claw-hive';
import { PostBroadcastService } from './post-broadcast.service.js';
import { MessageRouterService } from '../message/message-router.service.js';
import { SequenceService } from '../sequence/sequence.service.js';

// ── helpers ──────────────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

function mockDb() {
  const chain: Record<string, MockFn> = {};
  const methods = [
    'select',
    'from',
    'where',
    'limit',
    'insert',
    'values',
    'returning',
    'update',
    'set',
    'delete',
    'innerJoin',
    'leftJoin',
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.limit.mockResolvedValue([]);
  chain.returning.mockResolvedValue([]);
  // delete() is often terminal (no limit/returning)
  chain.delete.mockReturnValue(chain);
  chain.where.mockResolvedValue([]);
  // transaction: pass the same mockDb as the transaction context
  chain.transaction = jest.fn<any>((fn) => fn(chain));
  // insert inside transaction for createTrackingChannel
  chain.insert.mockReturnValue({
    values: jest.fn<any>().mockResolvedValue(undefined),
  });
  return chain;
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const MSG_ID = 'msg-uuid-1';
const SENDER_ID = 'sender-user-uuid';
const TENANT_ID = 'tenant-uuid-abcd1234';
const CHANNEL_ID = 'channel-uuid';
const THREAD_PARENT_ID = 'parent-msg-uuid';

const makeMessage = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: MSG_ID,
  channelId: CHANNEL_ID,
  senderId: SENDER_ID,
  content: 'Hello world',
  type: 'text',
  parentId: null,
  createdAt: new Date(),
  ...overrides,
});

const makeSender = () => ({
  id: SENDER_ID,
  username: 'alice',
  displayName: 'Alice',
  email: 'alice@test.com',
  userType: 'human',
});

const makeBotSender = () => ({
  id: SENDER_ID,
  username: 'claude',
  displayName: 'Claude',
  email: 'claude@test.com',
  userType: 'bot',
});

const makeChannel = (type: string = 'direct') => ({
  id: CHANNEL_ID,
  tenantId: TENANT_ID,
  type,
  name: type === 'direct' ? null : 'general',
});

// Use UUID-format user IDs so the HTML mention parser can match them
const BOT_UUIDS: Record<string, string> = {
  claude: '00000000-0000-0000-0000-000000000001',
  gemini: '00000000-0000-0000-0000-000000000002',
  chatgpt: '00000000-0000-0000-0000-000000000003',
};

const makeHiveBot = (key: string, opts: { mentorId?: string | null } = {}) => ({
  userId: BOT_UUIDS[key] ?? `00000000-0000-0000-0000-00000000${key}`,
  botId: `bot-id-${key}`,
  managedMeta: { agentId: `base-model-${key}-${TENANT_ID.slice(0, 8)}` },
  mentorId: opts.mentorId ?? null,
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('PostBroadcastService — pushToHiveBots', () => {
  let service: PostBroadcastService;
  let db: ReturnType<typeof mockDb>;
  let clawHiveService: { sendInput: MockFn };
  let rabbitMQEventService: { publishNotificationTask: MockFn };
  let routerService: { routeMessage: MockFn };
  let sequenceService: { generateChannelSeq: MockFn };

  beforeEach(async () => {
    db = mockDb();
    clawHiveService = {
      sendInput: jest.fn<any>().mockResolvedValue({ messages: [] }),
    };
    rabbitMQEventService = {
      publishNotificationTask: jest.fn<any>().mockResolvedValue(undefined),
    };
    routerService = {
      routeMessage: jest
        .fn<any>()
        .mockResolvedValue({ online: [], offline: [] }),
    };
    sequenceService = {
      generateChannelSeq: jest.fn<any>().mockResolvedValue(BigInt(1)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostBroadcastService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: RabbitMQEventService, useValue: rabbitMQEventService },
        { provide: ClawHiveService, useValue: clawHiveService },
        { provide: MessageRouterService, useValue: routerService },
        { provide: SequenceService, useValue: sequenceService },
      ],
    }).compile();

    service = module.get<PostBroadcastService>(PostBroadcastService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('marks the outbox completed and skips downstream work when there are no recipients', async () => {
    const getChannelMemberIds = jest
      .spyOn(service as any, 'getChannelMemberIds')
      .mockResolvedValue([SENDER_ID]);
    const updateUnreadCounts = jest
      .spyOn(service as any, 'updateUnreadCounts')
      .mockResolvedValue(undefined);
    const processNotificationTasks = jest
      .spyOn(service as any, 'processNotificationTasks')
      .mockResolvedValue(undefined);
    const pushToBotWebhooks = jest
      .spyOn(service as any, 'pushToBotWebhooks')
      .mockResolvedValue(undefined);
    const pushToHiveBots = jest
      .spyOn(service as any, 'pushToHiveBots')
      .mockResolvedValue(undefined);
    const markOutboxCompleted = jest
      .spyOn(service as any, 'markOutboxCompleted')
      .mockResolvedValue(undefined);

    await service.processTask({
      msgId: MSG_ID,
      channelId: CHANNEL_ID,
      senderId: SENDER_ID,
      broadcastAt: 1_000,
    });

    expect(getChannelMemberIds).toHaveBeenCalledWith(CHANNEL_ID);
    expect(updateUnreadCounts).not.toHaveBeenCalled();
    expect(processNotificationTasks).not.toHaveBeenCalled();
    expect(pushToBotWebhooks).not.toHaveBeenCalled();
    expect(pushToHiveBots).not.toHaveBeenCalled();
    expect(markOutboxCompleted).toHaveBeenCalledWith(MSG_ID);
  });

  it('runs the full post-broadcast orchestration when recipients exist', async () => {
    const memberIds = [SENDER_ID, 'recipient-1', 'recipient-2'];
    const getChannelMemberIds = jest
      .spyOn(service as any, 'getChannelMemberIds')
      .mockResolvedValue(memberIds);
    const updateUnreadCounts = jest
      .spyOn(service as any, 'updateUnreadCounts')
      .mockResolvedValue(undefined);
    const processNotificationTasks = jest
      .spyOn(service as any, 'processNotificationTasks')
      .mockResolvedValue(undefined);
    const pushToBotWebhooks = jest
      .spyOn(service as any, 'pushToBotWebhooks')
      .mockResolvedValue(undefined);
    const pushToHiveBots = jest
      .spyOn(service as any, 'pushToHiveBots')
      .mockResolvedValue(undefined);
    const markOutboxCompleted = jest
      .spyOn(service as any, 'markOutboxCompleted')
      .mockResolvedValue(undefined);
    const logger = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    (service as any).logger = logger;

    await service.processTask({
      msgId: MSG_ID,
      channelId: CHANNEL_ID,
      senderId: SENDER_ID,
      broadcastAt: 1_000,
    });

    expect(getChannelMemberIds).toHaveBeenCalledWith(CHANNEL_ID);
    expect(updateUnreadCounts).toHaveBeenCalledWith(CHANNEL_ID, [
      'recipient-1',
      'recipient-2',
    ]);
    expect(processNotificationTasks).toHaveBeenCalledWith(
      MSG_ID,
      CHANNEL_ID,
      SENDER_ID,
    );
    expect(pushToBotWebhooks).toHaveBeenCalledWith(
      MSG_ID,
      SENDER_ID,
      memberIds,
    );
    expect(pushToHiveBots).toHaveBeenCalledWith(MSG_ID, SENDER_ID, memberIds);
    expect(markOutboxCompleted).toHaveBeenCalledWith(MSG_ID);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining(`Post-broadcast completed for ${MSG_ID}`),
    );
  });

  it('logs and rethrows when post-broadcast orchestration fails', async () => {
    const failure = new Error('db down');
    const logger = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    (service as any).logger = logger;
    jest
      .spyOn(service as any, 'getChannelMemberIds')
      .mockRejectedValue(failure);

    await expect(
      service.processTask({
        msgId: MSG_ID,
        channelId: CHANNEL_ID,
        senderId: SENDER_ID,
        broadcastAt: 1_000,
      }),
    ).rejects.toThrow('db down');

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to process post-broadcast task: Error: db down',
    );
  });

  it('warns and returns when notification context is missing', async () => {
    const logger = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    (service as any).logger = logger;
    db.where.mockReturnValue(db);
    db.limit.mockResolvedValueOnce([]);

    await service.processNotificationTasks(MSG_ID, CHANNEL_ID, SENDER_ID);

    expect(logger.warn).toHaveBeenCalledWith(
      `Message ${MSG_ID} not found for notification processing`,
    );
    expect(rabbitMQEventService.publishNotificationTask).not.toHaveBeenCalled();
  });

  it('sends webhook payloads to active bots with custom headers', async () => {
    const botMember = {
      userId: 'bot-user-uuid',
      webhookUrl: 'https://example.test/webhook',
      webhookHeaders: {
        'X-Custom-Trace': 'trace-123',
      },
      botId: 'bot-id-123',
    };
    const message = makeMessage({ content: 'webhook payload' });
    const sender = makeSender();
    const channel = makeChannel('public');
    const getMessageWithContext = jest
      .spyOn(service as any, 'getMessageWithContext')
      .mockResolvedValue({
        message,
        sender,
        channel,
        mentions: [],
        parentMessage: null,
      });
    db.where.mockResolvedValueOnce([botMember]);
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true } as any);
    jest.spyOn(globalThis, 'setTimeout').mockImplementation((() => 0) as any);

    await (service as any).pushToBotWebhooks(MSG_ID, SENDER_ID, [
      botMember.userId,
    ]);

    expect(getMessageWithContext).toHaveBeenCalledWith(MSG_ID);
    expect(fetchMock).toHaveBeenCalledWith(
      botMember.webhookUrl,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Team9-Event': 'message.created',
          'X-Team9-Bot-Id': botMember.botId,
          'X-Custom-Trace': 'trace-123',
        }),
        body: expect.any(String),
      }),
    );
    expect(
      JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string),
    ).toEqual(
      expect.objectContaining({
        event: 'message.created',
        data: expect.objectContaining({
          messageId: MSG_ID,
          sender: expect.objectContaining({
            id: sender.id,
            username: sender.username,
          }),
          channel: expect.objectContaining({
            id: channel.id,
            type: channel.type,
          }),
        }),
      }),
    );
  });

  it('does not push bot-authored messages to bot webhooks', async () => {
    const botMember = {
      userId: 'bot-user-uuid',
      webhookUrl: 'https://example.test/webhook',
      webhookHeaders: {},
      botId: 'bot-id-123',
    };
    const getMessageWithContext = jest
      .spyOn(service as any, 'getMessageWithContext')
      .mockResolvedValue({
        message: makeMessage({ content: 'bot webhook payload' }),
        sender: makeBotSender(),
        channel: makeChannel('public'),
        mentions: [],
        parentMessage: null,
      });
    db.where.mockResolvedValueOnce([botMember]);
    const fetchMock = jest.spyOn(globalThis, 'fetch');

    await (service as any).pushToBotWebhooks(MSG_ID, SENDER_ID, [
      botMember.userId,
    ]);

    expect(getMessageWithContext).toHaveBeenCalledWith(MSG_ID);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not push deep-research messages to bot webhooks', async () => {
    const botMember = {
      userId: 'bot-user-uuid',
      webhookUrl: 'https://example.test/webhook',
      webhookHeaders: {},
      botId: 'bot-id-123',
    };
    const getMessageWithContext = jest
      .spyOn(service as any, 'getMessageWithContext')
      .mockResolvedValue({
        message: makeMessage({
          content: 'research this market',
          metadata: {
            deepResearch: {
              taskId: 'task-1',
              version: 1,
            },
          },
        }),
        sender: makeSender(),
        channel: makeChannel('direct'),
        mentions: [],
        parentMessage: null,
      });
    db.where.mockResolvedValueOnce([botMember]);
    const fetchMock = jest.spyOn(globalThis, 'fetch');

    await (service as any).pushToBotWebhooks(MSG_ID, SENDER_ID, [
      botMember.userId,
    ]);

    expect(getMessageWithContext).toHaveBeenCalledWith(MSG_ID);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('warns when a bot webhook responds with a non-ok status', async () => {
    const logger = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    (service as any).logger = logger;
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: false, status: 503 } as any);

    await (service as any).deliverWebhook(
      'https://example.test/webhook',
      'bot-id-123',
      { event: 'message.created' },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Team9-Event': 'message.created',
          'X-Team9-Bot-Id': 'bot-id-123',
        }),
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'Webhook returned 503 for bot bot-id-123',
    );
  });

  /** Helper: set up DB responses for one pushToHiveBots call */
  function setupDbForHivePush(opts: {
    bots: ReturnType<typeof makeHiveBot>[];
    message?: ReturnType<typeof makeMessage>;
    sender?: ReturnType<typeof makeSender>;
    channel?: ReturnType<typeof makeChannel>;
    parentMessage?: unknown;
  }) {
    const {
      bots,
      message = makeMessage(),
      sender = makeSender(),
      channel = makeChannel(),
      parentMessage = null,
    } = opts;

    // 1st where() call: hive bot query (terminal — no limit)
    db.where.mockResolvedValueOnce(bots);
    // getMessageWithContext calls use .where().limit(1) — where must return
    // chain (not a promise) so .limit() can be called.
    db.where
      .mockReturnValueOnce(db) // message query
      .mockReturnValueOnce(db) // sender query
      .mockReturnValueOnce(db); // channel query
    if (message.parentId) {
      db.where.mockReturnValueOnce(db); // parent message query
    }
    // Then set up .limit() return values for each query:
    db.limit
      .mockResolvedValueOnce([message]) // messages table
      .mockResolvedValueOnce([sender]) // users table
      .mockResolvedValueOnce([channel]) // channels table
      .mockResolvedValueOnce(parentMessage ? [parentMessage] : []); // parent
  }

  function setupDbForNotificationTasks(opts: {
    message?: ReturnType<typeof makeMessage>;
    sender?: ReturnType<typeof makeSender>;
    channel?: ReturnType<typeof makeChannel>;
    parentMessage?: unknown;
  }) {
    const {
      message = makeMessage(),
      sender = makeSender(),
      channel = makeChannel('public'),
      parentMessage = null,
    } = opts;

    db.where
      .mockReturnValueOnce(db) // message query
      .mockReturnValueOnce(db) // sender query
      .mockReturnValueOnce(db); // channel query
    if (message.parentId) {
      db.where.mockReturnValueOnce(db); // parent message query
    }
    db.where.mockResolvedValueOnce([]); // attachments query (no .limit())

    db.limit
      .mockResolvedValueOnce([message]) // messages table
      .mockResolvedValueOnce([sender]) // users table
      .mockResolvedValueOnce([channel]) // channels table
      .mockResolvedValueOnce(parentMessage ? [parentMessage] : []); // parent
  }

  // ── DM channel ─────────────────────────────────────────────────────────────

  it('triggers all hive bots in a DM channel regardless of @mention', async () => {
    const bot = makeHiveBot('claude');
    setupDbForHivePush({ bots: [bot], channel: makeChannel('direct') });

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [
      bot.userId,
      SENDER_ID,
    ]);

    expect(clawHiveService.sendInput).toHaveBeenCalledTimes(1);
    expect(clawHiveService.sendInput).toHaveBeenCalledWith(
      `team9/${TENANT_ID}/${bot.managedMeta.agentId}/dm/${CHANNEL_ID}`,
      expect.objectContaining({ type: 'team9:message.text' }),
      TENANT_ID,
    );
  });

  it('does not trigger hive bots for bot-authored messages', async () => {
    const bot = makeHiveBot('claude');
    setupDbForHivePush({
      bots: [bot],
      sender: makeBotSender(),
      channel: makeChannel('direct'),
    });

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

    expect(clawHiveService.sendInput).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('does not trigger hive bots for deep-research messages', async () => {
    const bot = makeHiveBot('claude');
    setupDbForHivePush({
      bots: [bot],
      message: makeMessage({
        content: 'research this market',
        metadata: {
          deepResearch: {
            taskId: 'task-1',
            version: 1,
          },
        },
      }),
      channel: makeChannel('direct'),
    });

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

    expect(clawHiveService.sendInput).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('builds correct session ID for a DM channel', async () => {
    const bot = makeHiveBot('claude');
    setupDbForHivePush({ bots: [bot], channel: makeChannel('direct') });

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

    const [sessionId] = clawHiveService.sendInput.mock.calls[0] as [
      string,
      ...unknown[],
    ];
    expect(sessionId).toBe(
      `team9/${TENANT_ID}/${bot.managedMeta.agentId}/dm/${CHANNEL_ID}`,
    );
  });

  // ── team9Context derivation ──────────────────────────────────────────────

  it('injects team9Context with isMentorDm=true when sender is the bot mentor in a DM', async () => {
    const bot = makeHiveBot('claude', { mentorId: SENDER_ID });
    setupDbForHivePush({ bots: [bot], channel: makeChannel('direct') });

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

    const [, event] = clawHiveService.sendInput.mock.calls[0] as [
      string,
      { payload: { team9Context: Record<string, unknown> } },
      ...unknown[],
    ];
    expect(event.payload.team9Context).toEqual({
      source: 'team9',
      scopeType: 'dm',
      scopeId: CHANNEL_ID,
      peerUserId: SENDER_ID,
      isMentorDm: true,
    });
  });

  it('injects team9Context with isMentorDm=false when sender is NOT the bot mentor', async () => {
    // Bot has no mentor — isMentorDm should be false.
    const bot = makeHiveBot('claude', { mentorId: null });
    setupDbForHivePush({ bots: [bot], channel: makeChannel('direct') });

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

    const [, event] = clawHiveService.sendInput.mock.calls[0] as [
      string,
      { payload: { team9Context: { isMentorDm: boolean } } },
      ...unknown[],
    ];
    expect(event.payload.team9Context.isMentorDm).toBe(false);
  });

  it('injects team9Context with isMentorDm=false in a DM when sender differs from bot mentor (mentor-change scenario)', async () => {
    // Mentor changed to someone else. Alice (SENDER_ID) is no longer the mentor,
    // so her messages should no longer carry isMentorDm=true.
    const bot = makeHiveBot('claude', { mentorId: 'different-user-uuid' });
    setupDbForHivePush({ bots: [bot], channel: makeChannel('direct') });

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

    const [, event] = clawHiveService.sendInput.mock.calls[0] as [
      string,
      { payload: { team9Context: { isMentorDm: boolean } } },
      ...unknown[],
    ];
    expect(event.payload.team9Context.isMentorDm).toBe(false);
  });

  it('injects team9Context with scopeType=channel for non-DM channels', async () => {
    const bot = makeHiveBot('claude', { mentorId: SENDER_ID });
    // @mention required so the group-channel trigger fires
    const msg = makeMessage({
      content: `<mention data-user-id="${bot.userId}">@Claude</mention> hi`,
    });
    setupDbForHivePush({
      bots: [bot],
      message: msg,
      channel: makeChannel('public'),
    });

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

    const [, event] = clawHiveService.sendInput.mock.calls[0] as [
      string,
      { payload: { team9Context: Record<string, unknown> } },
      ...unknown[],
    ];
    expect(event.payload.team9Context).toEqual({
      source: 'team9',
      scopeType: 'channel',
      scopeId: CHANNEL_ID,
      peerUserId: SENDER_ID,
      // Even when sender.id === bot.mentorId, a non-DM channel must not report
      // isMentorDm=true — the "mentor DM" concept only applies inside DMs.
      isMentorDm: false,
    });
  });

  it('builds correct session ID for a group channel (tracking/ scope)', async () => {
    const bot = makeHiveBot('claude');
    // Include @mention in content so the group-channel trigger fires
    const msg = makeMessage({
      content: `<mention data-user-id="${bot.userId}">@Claude</mention> hello`,
    });
    setupDbForHivePush({
      bots: [bot],
      message: msg,
      channel: makeChannel('public'),
    });

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

    const [sessionId] = clawHiveService.sendInput.mock.calls[0] as [
      string,
      ...unknown[],
    ];
    // Group @mention creates a new tracking channel; session uses tracking/ scope
    expect(sessionId).toMatch(
      new RegExp(
        `^team9/${TENANT_ID}/${bot.managedMeta.agentId}/tracking/[\\w-]+$`,
      ),
    );
  });

  // ── Group channel (mention gate) ────────────────────────────────────────────

  it('does NOT trigger a hive bot in a group channel without @mention', async () => {
    const bot = makeHiveBot('claude');
    // No mention of the bot
    const msg = makeMessage({ content: 'Hello everyone' });
    setupDbForHivePush({
      bots: [bot],
      message: msg,
      channel: makeChannel('public'),
    });

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

    expect(clawHiveService.sendInput).not.toHaveBeenCalled();
  });

  it('triggers only @mentioned bots when multiple hive bots are in the channel', async () => {
    const claude = makeHiveBot('claude');
    const gemini = makeHiveBot('gemini');
    // Mention only claude
    const msg = makeMessage({
      content: `<mention data-user-id="${claude.userId}">@Claude</mention> help`,
    });
    setupDbForHivePush({
      bots: [claude, gemini],
      message: msg,
      channel: makeChannel('public'),
    });

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [
      claude.userId,
      gemini.userId,
    ]);

    expect(clawHiveService.sendInput).toHaveBeenCalledTimes(1);
    const [sessionId] = clawHiveService.sendInput.mock.calls[0] as [
      string,
      ...unknown[],
    ];
    expect(sessionId).toContain(claude.managedMeta.agentId);
  });

  // ── Sender exclusion ────────────────────────────────────────────────────────

  it('excludes the sender even if they are a hive bot', async () => {
    const bot = makeHiveBot('claude');
    setupDbForHivePush({ bots: [bot], channel: makeChannel('direct') });

    // Sender IS the bot
    await (service as any).pushToHiveBots(MSG_ID, bot.userId, [bot.userId]);

    expect(clawHiveService.sendInput).not.toHaveBeenCalled();
  });

  // ── Event payload ───────────────────────────────────────────────────────────

  it('sends correct event payload with message content and sender info', async () => {
    const bot = makeHiveBot('claude');
    const msg = makeMessage({ content: 'Test content' });
    const sender = makeSender();
    setupDbForHivePush({ bots: [bot], message: msg, sender });

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

    const [, event] = clawHiveService.sendInput.mock.calls[0] as [
      string,
      any,
      string,
    ];
    expect(event.type).toBe('team9:message.text');
    expect(event.source).toBe('team9');
    expect(event.payload.messageId).toBe(MSG_ID);
    expect(event.payload.content).toBe('Test content');
    expect(event.payload.sender.id).toBe(sender.id);
    expect(event.payload.sender.username).toBe(sender.username);
  });

  it('builds flat channel location for top-level messages', async () => {
    const bot = makeHiveBot('claude');
    setupDbForHivePush({ bots: [bot], channel: makeChannel('direct') });

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

    const [, event] = clawHiveService.sendInput.mock.calls[0] as [
      string,
      any,
      string,
    ];
    expect(event.payload.location).toEqual(
      expect.objectContaining({ type: 'dm', id: CHANNEL_ID }),
    );
    expect(event.payload.location.parent).toBeUndefined();
  });

  it('builds nested thread location for replies', async () => {
    const bot = makeHiveBot('claude');
    const msg = makeMessage({ parentId: THREAD_PARENT_ID });
    const parentMsg = { id: THREAD_PARENT_ID, content: 'Parent content' };
    setupDbForHivePush({
      bots: [bot],
      message: msg,
      channel: makeChannel('direct'),
      parentMessage: parentMsg,
    });

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

    const [, event] = clawHiveService.sendInput.mock.calls[0] as [
      string,
      any,
      string,
    ];
    expect(event.payload.location.type).toBe('thread');
    expect(event.payload.location.id).toBe(THREAD_PARENT_ID);
    expect(event.payload.location.parent).toEqual(
      expect.objectContaining({ type: 'dm', id: CHANNEL_ID }),
    );
  });

  // ── Edge cases ──────────────────────────────────────────────────────────────

  it('returns early without DB queries when memberIds is empty', async () => {
    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, []);

    expect(db.select).not.toHaveBeenCalled();
    expect(clawHiveService.sendInput).not.toHaveBeenCalled();
  });

  it('returns early when no hive bots are in the channel', async () => {
    db.where.mockResolvedValueOnce([]);

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, ['some-user-id']);

    expect(clawHiveService.sendInput).not.toHaveBeenCalled();
  });

  it('skips bots with missing managedMeta.agentId', async () => {
    const brokenBot = { userId: 'bot-x', botId: 'id-x', managedMeta: null };
    db.where.mockResolvedValueOnce([brokenBot]);

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, ['bot-x']);

    expect(clawHiveService.sendInput).not.toHaveBeenCalled();
  });

  it('does not throw when sendInput rejects (fire-and-forget)', async () => {
    const bot = makeHiveBot('claude');
    setupDbForHivePush({ bots: [bot] });
    clawHiveService.sendInput.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]),
    ).resolves.not.toThrow();
  });

  it('does not throw when a DB query inside pushToHiveBots throws', async () => {
    db.where.mockRejectedValueOnce(new Error('DB connection lost'));

    await expect(
      (service as any).pushToHiveBots(MSG_ID, SENDER_ID, ['some-member']),
    ).resolves.not.toThrow();
  });

  // ── Notification task suppression ─────────────────────────────────────────

  it('does not publish notification tasks for tracking channels', async () => {
    const bot = makeHiveBot('claude');
    const msg = makeMessage({
      content: `<mention data-user-id="${bot.userId}">@Claude</mention> hello`,
    });
    setupDbForNotificationTasks({
      message: msg,
      channel: makeChannel('tracking'),
    });

    await service.processNotificationTasks(MSG_ID, CHANNEL_ID, SENDER_ID);

    expect(rabbitMQEventService.publishNotificationTask).not.toHaveBeenCalled();
  });

  it('does not publish DM notifications for bot-authored direct messages', async () => {
    const msg = makeMessage({ content: 'bot direct message' });
    setupDbForNotificationTasks({
      message: msg,
      sender: makeBotSender(),
      channel: makeChannel('direct'),
    });

    await service.processNotificationTasks(MSG_ID, CHANNEL_ID, SENDER_ID);

    expect(rabbitMQEventService.publishNotificationTask).not.toHaveBeenCalled();
  });

  it('does not publish notification tasks for bot-authored direct message replies', async () => {
    const msg = makeMessage({
      content: 'bot direct reply',
      parentId: THREAD_PARENT_ID,
    });
    const parentMessage = {
      id: THREAD_PARENT_ID,
      senderId: 'recipient-user-uuid',
    };
    setupDbForNotificationTasks({
      message: msg,
      sender: makeBotSender(),
      channel: makeChannel('direct'),
      parentMessage,
    });

    await service.processNotificationTasks(MSG_ID, CHANNEL_ID, SENDER_ID);

    expect(rabbitMQEventService.publishNotificationTask).not.toHaveBeenCalled();
  });

  it('publishes DM notifications for human-authored direct messages', async () => {
    const msg = makeMessage({ content: 'human direct message' });
    setupDbForNotificationTasks({
      message: msg,
      sender: makeSender(),
      channel: makeChannel('direct'),
    });
    db.where.mockResolvedValueOnce([
      { userId: 'recipient-user-uuid' },
      { userId: SENDER_ID },
    ]);

    await service.processNotificationTasks(MSG_ID, CHANNEL_ID, SENDER_ID);

    expect(rabbitMQEventService.publishNotificationTask).toHaveBeenCalledTimes(
      1,
    );
    expect(rabbitMQEventService.publishNotificationTask).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'dm',
        payload: expect.objectContaining({
          messageId: MSG_ID,
          channelId: CHANNEL_ID,
          senderId: SENDER_ID,
          recipientId: 'recipient-user-uuid',
        }),
      }),
    );
  });

  it('publishes mention, reply, and DM notifications for human-authored direct thread replies', async () => {
    const targetUserId = '00000000-0000-0000-0000-000000000004';
    const rootMessageId = 'root-message-uuid';
    const rootSenderId = 'root-sender-uuid';
    const parentSenderId = 'parent-sender-uuid';
    const msg = makeMessage({
      content: `<mention data-user-id="${targetUserId}">@Recipient</mention> thread reply`,
      parentId: THREAD_PARENT_ID,
      rootId: rootMessageId,
    });
    const parentMessage = {
      id: THREAD_PARENT_ID,
      senderId: parentSenderId,
    };
    setupDbForNotificationTasks({
      message: msg,
      sender: makeSender(),
      channel: makeChannel('direct'),
      parentMessage,
    });
    db.where.mockReturnValueOnce(db);
    db.limit.mockResolvedValueOnce([
      { id: rootMessageId, senderId: rootSenderId },
    ]);
    db.where.mockResolvedValueOnce([
      { userId: targetUserId },
      { userId: SENDER_ID },
    ]);

    await service.processNotificationTasks(MSG_ID, CHANNEL_ID, SENDER_ID);

    expect(rabbitMQEventService.publishNotificationTask).toHaveBeenCalledTimes(
      3,
    );
    expect(
      rabbitMQEventService.publishNotificationTask,
    ).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'mention',
        payload: expect.objectContaining({
          messageId: MSG_ID,
          channelId: CHANNEL_ID,
          tenantId: TENANT_ID,
          mentions: [{ userId: targetUserId, type: 'user' }],
        }),
      }),
    );
    expect(
      rabbitMQEventService.publishNotificationTask,
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'reply',
        payload: expect.objectContaining({
          messageId: MSG_ID,
          channelId: CHANNEL_ID,
          parentMessageId: THREAD_PARENT_ID,
          parentSenderId,
          rootMessageId,
          rootSenderId,
          isThreadReply: true,
        }),
      }),
    );
    expect(
      rabbitMQEventService.publishNotificationTask,
    ).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: 'dm',
        payload: expect.objectContaining({
          messageId: MSG_ID,
          channelId: CHANNEL_ID,
          recipientId: targetUserId,
        }),
      }),
    );
  });

  it('still publishes mention notifications for bots in normal channels', async () => {
    const bot = makeHiveBot('claude');
    const msg = makeMessage({
      content: `<mention data-user-id="${bot.userId}">@Claude</mention> hello`,
    });
    setupDbForNotificationTasks({
      message: msg,
      channel: makeChannel('public'),
    });

    await service.processNotificationTasks(MSG_ID, CHANNEL_ID, SENDER_ID);

    expect(rabbitMQEventService.publishNotificationTask).toHaveBeenCalledTimes(
      1,
    );
    expect(rabbitMQEventService.publishNotificationTask).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mention',
        payload: expect.objectContaining({
          messageId: MSG_ID,
          channelId: CHANNEL_ID,
          senderId: SENDER_ID,
          mentions: [{ userId: bot.userId, type: 'user' }],
        }),
      }),
    );
  });

  // ── Tracking channel ─────────────────────────────────────────────

  it('creates tracking channel for group @mention and uses tracking/ session scope', async () => {
    const bot = makeHiveBot('claude');
    const msg = makeMessage({
      content: `<mention data-user-id="${bot.userId}">@Claude</mention> hello`,
    });
    setupDbForHivePush({
      bots: [bot],
      message: msg,
      channel: makeChannel('public'),
    });
    // getChannelMemberIds called after tracking channel creation for broadcast
    db.where.mockResolvedValueOnce([
      { userId: bot.userId },
      { userId: SENDER_ID },
    ]);

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

    // Verify tracking channel was created (transaction called)
    expect(db.transaction).toHaveBeenCalled();

    // Verify session ID uses tracking/ scope
    const [sessionId] = clawHiveService.sendInput.mock.calls[0] as [
      string,
      ...unknown[],
    ];
    expect(sessionId).toMatch(
      new RegExp(
        `^team9/${TENANT_ID}/${bot.managedMeta.agentId}/tracking/[\\w-]+$`,
      ),
    );
  });

  it('does NOT create tracking channel for DM — uses dm/ scope', async () => {
    const bot = makeHiveBot('claude');
    setupDbForHivePush({ bots: [bot], channel: makeChannel('direct') });

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

    // No transaction = no tracking channel created
    expect(db.transaction).not.toHaveBeenCalled();

    const [sessionId] = clawHiveService.sendInput.mock.calls[0] as [
      string,
      ...unknown[],
    ];
    expect(sessionId).toBe(
      `team9/${TENANT_ID}/${bot.managedMeta.agentId}/dm/${CHANNEL_ID}`,
    );
  });

  it('routes routine-session channel message to dm/ scope without creating tracking channel', async () => {
    const bot = makeHiveBot('claude');
    setupDbForHivePush({
      bots: [bot],
      channel: makeChannel('routine-session'),
    });

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

    expect(clawHiveService.sendInput).toHaveBeenCalledTimes(1);
    const [sessionId, event] = clawHiveService.sendInput.mock.calls[0] as [
      string,
      any,
      string,
    ];
    // Session id uses dm/ scope with the original channel id — the bot
    // stays on the same session as the kickoff event.
    expect(sessionId).toBe(
      `team9/${TENANT_ID}/${bot.managedMeta.agentId}/dm/${CHANNEL_ID}`,
    );
    // Channel location reports as 'dm' so bot context matches kickoff.
    expect(event.payload.location.type).toBe('dm');
    // Fanout happened without @mention — routine-session is alwaysForward.
    expect(event.payload.trackingChannelId).toBeUndefined();
  });

  it('forwards routine-session message even without @mention (alwaysForward)', async () => {
    // The default makeMessage() content has no @mention of any bot. A
    // group channel would drop this message unless the bot is mentioned.
    // routine-session must bypass that check entirely.
    const bot = makeHiveBot('claude');
    setupDbForHivePush({
      bots: [bot],
      channel: makeChannel('routine-session'),
    });

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

    expect(clawHiveService.sendInput).toHaveBeenCalledTimes(1);
  });

  it('does not create a tracking channel for routine-session', async () => {
    const bot = makeHiveBot('claude');
    const createTrackingSpy = jest.spyOn(
      service as any,
      'createTrackingChannel',
    );
    setupDbForHivePush({
      bots: [bot],
      channel: makeChannel('routine-session'),
    });

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

    expect(createTrackingSpy).not.toHaveBeenCalled();
  });

  it('routes tracking channel message to same session without creating new channel', async () => {
    const bot = makeHiveBot('claude');
    setupDbForHivePush({ bots: [bot], channel: makeChannel('tracking') });

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

    // No transaction = no new tracking channel
    expect(db.transaction).not.toHaveBeenCalled();

    // Session uses existing tracking channel ID
    const [sessionId] = clawHiveService.sendInput.mock.calls[0] as [
      string,
      ...unknown[],
    ];
    expect(sessionId).toBe(
      `team9/${TENANT_ID}/${bot.managedMeta.agentId}/tracking/${CHANNEL_ID}`,
    );
  });

  it('includes trackingChannelId in payload for group channel, not for DM', async () => {
    // Group channel
    const bot = makeHiveBot('claude');
    const msg = makeMessage({
      content: `<mention data-user-id="${bot.userId}">@Claude</mention> hello`,
    });
    setupDbForHivePush({
      bots: [bot],
      message: msg,
      channel: makeChannel('public'),
    });
    // getChannelMemberIds for placeholder broadcast
    db.where.mockResolvedValueOnce([
      { userId: bot.userId },
      { userId: SENDER_ID },
    ]);

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

    const [, groupEvent] = clawHiveService.sendInput.mock.calls[0] as [
      string,
      any,
      string,
    ];
    expect(groupEvent.payload.trackingChannelId).toBeDefined();

    // DM channel — reset mock state so stale queued return values don't bleed across
    clawHiveService.sendInput.mockClear();
    db.where.mockReset();
    db.limit.mockReset();
    db.where.mockResolvedValue([]);
    db.limit.mockResolvedValue([]);
    setupDbForHivePush({ bots: [bot], channel: makeChannel('direct') });

    await (service as any).pushToHiveBots(MSG_ID, SENDER_ID, [bot.userId]);

    const [, dmEvent] = clawHiveService.sendInput.mock.calls[0] as [
      string,
      any,
      string,
    ];
    expect(dmEvent.payload.trackingChannelId).toBeUndefined();
  });
});
