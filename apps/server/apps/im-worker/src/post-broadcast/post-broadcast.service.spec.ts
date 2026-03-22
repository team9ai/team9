import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { DATABASE_CONNECTION } from '@team9/database';
import { RabbitMQEventService } from '@team9/rabbitmq';
import { ClawHiveService } from '@team9/claw-hive';
import { PostBroadcastService } from './post-broadcast.service.js';

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
});

const makeChannel = (type: string = 'direct') => ({
  id: CHANNEL_ID,
  tenantId: TENANT_ID,
  type,
  name: type === 'direct' ? null : 'general',
});

const makeHiveBot = (key: string) => ({
  userId: `bot-user-${key}`,
  botId: `bot-id-${key}`,
  managedMeta: { agentId: `base-model-${key}-${TENANT_ID.slice(0, 8)}` },
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('PostBroadcastService — pushToHiveBots', () => {
  let service: PostBroadcastService;
  let db: ReturnType<typeof mockDb>;
  let clawHiveService: { sendInput: MockFn };
  let rabbitMQEventService: { publishNotificationTask: MockFn };

  beforeEach(async () => {
    db = mockDb();
    clawHiveService = {
      sendInput: jest.fn<any>().mockResolvedValue({ messages: [] }),
    };
    rabbitMQEventService = {
      publishNotificationTask: jest.fn<any>().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostBroadcastService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: RabbitMQEventService, useValue: rabbitMQEventService },
        { provide: ClawHiveService, useValue: clawHiveService },
      ],
    }).compile();

    service = module.get<PostBroadcastService>(PostBroadcastService);
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
    // Then getMessageWithContext calls (all end with .limit(1)):
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

  it('builds correct session ID for a group channel', async () => {
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
    expect(sessionId).toBe(
      `team9/${TENANT_ID}/${bot.managedMeta.agentId}/channel/${CHANNEL_ID}`,
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
});
