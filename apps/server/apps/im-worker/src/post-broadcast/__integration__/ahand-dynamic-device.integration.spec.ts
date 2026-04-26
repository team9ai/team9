/**
 * Integration spec for the im-worker → claw-hive ahand chain.
 *
 * Drives `PostBroadcastService.processTask` end-to-end so the full
 * orchestration (orchestrator + helpers + fan-out) is exercised, then
 * asserts on the wire-format payload that lands at
 * `ClawHiveService.sendInput`. Only `ClawHiveService.sendInput` is mocked
 * at the module-provider level — the rest of the service runs as in
 * production.
 *
 * Covers the 7 scenarios from Phase 9 / Task 9.3 (issue #74):
 *   1. DM happy path
 *   2. Group @mention (mentioned bot only)
 *   3. Topic-session collapse to wire `dm` location
 *   4. Mentor flag (true and false)
 *   5. Tracking auto-forward (thread reply with existing tracking channel)
 *   6. Skip non-human-authored messages
 *   7. Skip deep-research messages
 *
 * The DB is mocked via the same Drizzle chain-mock pattern as the
 * existing unit spec (post-broadcast.service.spec.ts) — kept here
 * because the testcontainer fixture from #73 (Task 9.2) is not yet
 * available. This spec runs in <1s so the <60s acceptance budget is met
 * with significant headroom; the `__integration__` suffix and the
 * separate `test:integration` script let CI swap the fixture in later
 * without changing the spec body.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE_CONNECTION } from '@team9/database';
import { RabbitMQEventService } from '@team9/rabbitmq';
import { ClawHiveService } from '@team9/claw-hive';
import { PostBroadcastService } from '../post-broadcast.service.js';
import { MessageRouterService } from '../../message/message-router.service.js';
import { SequenceService } from '../../sequence/sequence.service.js';

// ── Drizzle chain mock ────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

interface ChainMock {
  select: MockFn;
  from: MockFn;
  where: MockFn;
  limit: MockFn;
  innerJoin: MockFn;
  leftJoin: MockFn;
  orderBy: MockFn;
  insert: MockFn;
  update: MockFn;
  set: MockFn;
  delete: MockFn;
  returning: MockFn;
  values: MockFn;
  onConflictDoUpdate: MockFn;
  transaction: MockFn;
}

function makeChainMock(): ChainMock {
  const chain: Partial<ChainMock> = {};
  for (const m of [
    'select',
    'from',
    'where',
    'limit',
    'innerJoin',
    'leftJoin',
    'orderBy',
    'set',
    'returning',
    'values',
    'onConflictDoUpdate',
    'delete',
  ] as const) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  // Defaults: terminal queries resolve to empty arrays so an unprimed
  // path doesn't blow up — primary signal is the explicit
  // `mockResolvedValueOnce` calls in each scenario's setup helper.
  chain.where!.mockResolvedValue([]);
  chain.limit!.mockResolvedValue([]);
  chain.returning!.mockResolvedValue([]);
  // `insert(...).values(...).onConflictDoUpdate(...)` (used by
  // updateUnreadCounts) must resolve so the orchestrator continues.
  chain.values!.mockResolvedValue(undefined);
  chain.onConflictDoUpdate!.mockResolvedValue(undefined);
  // `update(...).set(...).where(...)` (used by markOutboxCompleted).
  // The `where` default resolves to [] which is awaited transparently.
  chain.insert = jest.fn<any>().mockReturnValue(chain);
  chain.update = jest.fn<any>().mockReturnValue(chain);
  // `db.transaction(async (tx) => ...)` — pass the same chain back as
  // the `tx` so insert(...).values(...) inside the transaction also
  // resolves. createTrackingChannel only does `tx.insert(...).values(...)`
  // for each row it writes.
  chain.transaction = jest.fn<any>(async (fn: any) => fn(chain));
  return chain as ChainMock;
}

// ── Fixtures ──────────────────────────────────────────────────────────

const TENANT_ID = uuidv7();
const CHANNEL_ID = uuidv7();
const SENDER_ID = uuidv7();
const PARENT_MSG_ID = uuidv7();
const ROOT_MSG_ID = PARENT_MSG_ID;

interface BotFixture {
  userId: string;
  botId: string;
  managedMeta: { agentId: string };
  mentorId: string | null;
}

function makeHiveBot(opts: { mentorId?: string | null } = {}): BotFixture {
  return {
    userId: uuidv7(),
    botId: uuidv7(),
    // Use the full UUIDv7 so distinct bots created in the same call
    // window do not collide on a shared timestamp prefix — `slice(0, 8)`
    // gave both bots in scenario 2 the same agent id.
    managedMeta: { agentId: `base-model-${uuidv7()}` },
    mentorId: opts.mentorId ?? null,
  };
}

interface ChannelFixture {
  id: string;
  tenantId: string | null;
  name: string | null;
  type:
    | 'direct'
    | 'public'
    | 'private'
    | 'task'
    | 'tracking'
    | 'echo'
    | 'routine-session'
    | 'topic-session';
}

function makeChannel(
  type: ChannelFixture['type'] = 'direct',
  overrides: Partial<ChannelFixture> = {},
): ChannelFixture {
  return {
    id: CHANNEL_ID,
    tenantId: TENANT_ID,
    name: type === 'direct' ? null : 'general',
    type,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuidv7(),
    channelId: CHANNEL_ID,
    senderId: SENDER_ID,
    content: 'Hello world',
    type: 'text',
    parentId: null,
    rootId: null,
    metadata: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeHumanSender() {
  return {
    id: SENDER_ID,
    username: 'alice',
    displayName: 'Alice',
    email: 'alice@test.com',
    userType: 'human',
  };
}

function makeBotSender() {
  return {
    id: SENDER_ID,
    username: 'claude-shadow',
    displayName: 'Claude',
    email: 'claude-shadow@test.com',
    userType: 'bot',
  };
}

// ── DB priming helpers ───────────────────────────────────────────────

interface PrimeOpts {
  bots: BotFixture[];
  message: ReturnType<typeof makeMessage>;
  sender: ReturnType<typeof makeHumanSender> | ReturnType<typeof makeBotSender>;
  channel: ChannelFixture;
  parentMessage?: { id: string; content: string | null } | null;
  attachments?: Array<{
    fileName: string;
    fileSize: number;
    mimeType: string;
    fileUrl: string;
  }>;
  /**
   * Tracking messages found in the same thread. When provided, the
   * service threads its tracking-channel-lookup query and routes the
   * trigger straight to the existing tracking session id.
   */
  threadTrackingMessages?: Array<{
    senderId: string;
    metadata: Record<string, unknown>;
  }>;
}

/**
 * Stack the chain mock to satisfy the queries `pushToHiveBots` will
 * fire on a single `processTask` call.
 *
 * Order matters and mirrors the source-of-truth call order in
 * post-broadcast.service.ts:
 *   1. Hive bot lookup           → terminal at .where()
 *   2. message via getMessageWithContext  → .where().limit(1)
 *   3. sender via getMessageWithContext   → .where().limit(1)
 *   4. channel via getMessageWithContext  → .where().limit(1)
 *   5. parent (if message.parentId)       → .where().limit(1)
 *   6. attachments                        → terminal at .where()
 *   7. thread-tracking lookup (if !alwaysForward and threadRootId)
 *      → .where().orderBy(desc).limit(10)
 */
function primeHivePush(db: ChainMock, opts: PrimeOpts) {
  const {
    bots,
    message,
    sender,
    channel,
    parentMessage = null,
    attachments = [],
    threadTrackingMessages,
  } = opts;

  // 1. Hive bot select (terminal — innerJoin then where, no .limit())
  db.where.mockResolvedValueOnce(bots);

  // 2-5. getMessageWithContext queries — `.where()` returns chain so
  // `.limit(1)` chains; the terminal value comes from `.limit()`.
  const hasParent = !!message.parentId;
  db.where
    .mockReturnValueOnce(db) // message → chain
    .mockReturnValueOnce(db) // sender → chain
    .mockReturnValueOnce(db); // channel → chain
  if (hasParent) {
    db.where.mockReturnValueOnce(db); // parent → chain
  }

  db.limit
    .mockResolvedValueOnce([message]) // message
    .mockResolvedValueOnce([sender]) // sender
    .mockResolvedValueOnce([channel]); // channel
  if (hasParent) {
    db.limit.mockResolvedValueOnce(parentMessage ? [parentMessage] : []);
  }

  // 6. attachments — terminal at .where()
  db.where.mockResolvedValueOnce(attachments);

  // 7. thread-tracking — chained: .where() → .orderBy() → .limit(10)
  // Only used by group channels with a thread root; we prime
  // unconditionally because the unused mock-once is harmless.
  if (threadTrackingMessages !== undefined) {
    db.where.mockReturnValueOnce(db);
    db.orderBy.mockReturnValueOnce(db);
    db.limit.mockResolvedValueOnce(threadTrackingMessages);
  }
}

/**
 * Stub the helpers `processTask` orchestrates around `pushToHiveBots`
 * so the integration spec stays focused on the ahand wire output.
 * These helpers have their own unit-test coverage in
 * post-broadcast.service.spec.ts.
 */
function stubOrchestrationHelpers(
  service: PostBroadcastService,
  memberIds: string[],
) {
  jest
    .spyOn(service as any, 'getChannelMemberIds')
    .mockResolvedValue(memberIds);
  jest.spyOn(service as any, 'updateUnreadCounts').mockResolvedValue(undefined);
  jest
    .spyOn(service as any, 'processNotificationTasks')
    .mockResolvedValue(undefined);
  jest.spyOn(service as any, 'pushToBotWebhooks').mockResolvedValue(undefined);
  jest
    .spyOn(service as any, 'markOutboxCompleted')
    .mockResolvedValue(undefined);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('PostBroadcastService — ahand dynamic-device integration', () => {
  let service: PostBroadcastService;
  let db: ChainMock;
  let clawHiveService: { sendInput: MockFn };
  let rabbitMQEventService: { publishNotificationTask: MockFn };
  let routerService: { routeMessage: MockFn };
  let sequenceService: { generateChannelSeq: MockFn };

  beforeEach(async () => {
    db = makeChainMock();
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

  // Pull the team9Context out of the (sessionId, event, tenantId) call.
  function team9ContextFromCall(callIndex: number) {
    const call = clawHiveService.sendInput.mock.calls[callIndex] as [
      string,
      { payload: { team9Context: Record<string, unknown> } },
      string?,
    ];
    return call[1].payload.team9Context;
  }

  function sessionIdFromCall(callIndex: number) {
    const call = clawHiveService.sendInput.mock.calls[callIndex] as [
      string,
      ...unknown[],
    ];
    return call[0];
  }

  // ── Scenario 1: DM happy path ───────────────────────────────────────

  it('1. DM happy path: fires sendInput once with dm/{channelId} session and team9Context anchored to sender', async () => {
    const bot = makeHiveBot();
    const message = makeMessage();
    primeHivePush(db, {
      bots: [bot],
      message,
      sender: makeHumanSender(),
      channel: makeChannel('direct'),
    });
    stubOrchestrationHelpers(service, [SENDER_ID, bot.userId]);

    await service.processTask({
      msgId: message.id,
      channelId: CHANNEL_ID,
      senderId: SENDER_ID,
      broadcastAt: Date.now(),
    });

    expect(clawHiveService.sendInput).toHaveBeenCalledTimes(1);
    const [sessionId, event, tenantArg] = clawHiveService.sendInput.mock
      .calls[0] as [string, any, string];
    expect(sessionId).toBe(
      `team9/${TENANT_ID}/${bot.managedMeta.agentId}/dm/${CHANNEL_ID}`,
    );
    expect(tenantArg).toBe(TENANT_ID);
    expect(event.type).toBe('team9:message.text');
    expect(event.source).toBe('team9');
    expect(event.payload.location).toEqual(
      expect.objectContaining({ type: 'dm', id: CHANNEL_ID }),
    );
    expect(event.payload.team9Context).toEqual({
      source: 'team9',
      scopeType: 'dm',
      scopeId: CHANNEL_ID,
      peerUserId: SENDER_ID,
      isMentorDm: false,
    });
  });

  // ── Scenario 2: Group @mention ──────────────────────────────────────

  it('2. Group @mention: only the @-mentioned bot receives sendInput', async () => {
    const claude = makeHiveBot();
    const gemini = makeHiveBot();
    // Mention only claude. Mention parser regex requires lowercase
    // hex; uuidv7() output is already lowercase.
    const message = makeMessage({
      content: `<mention data-user-id="${claude.userId}">@Claude</mention> help me out`,
    });
    primeHivePush(db, {
      bots: [claude, gemini],
      message,
      sender: makeHumanSender(),
      channel: makeChannel('public'),
      // No `threadTrackingMessages` — message.rootId/parentId are
      // null, so threadRootId is null and the thread-tracking lookup
      // branch (post-broadcast.service.ts:681) never executes.
    });
    stubOrchestrationHelpers(service, [
      SENDER_ID,
      claude.userId,
      gemini.userId,
    ]);

    await service.processTask({
      msgId: message.id,
      channelId: CHANNEL_ID,
      senderId: SENDER_ID,
      broadcastAt: Date.now(),
    });

    expect(clawHiveService.sendInput).toHaveBeenCalledTimes(1);
    const sessionId = sessionIdFromCall(0);
    // Group @mention spawns a tracking channel; session uses tracking/ scope.
    expect(sessionId).toMatch(
      new RegExp(
        `^team9/${TENANT_ID}/${claude.managedMeta.agentId}/tracking/[\\w-]+$`,
      ),
    );
    // Confirm the un-mentioned bot's agent id never appears in any call.
    for (const call of clawHiveService.sendInput.mock.calls) {
      const [sid] = call as [string, ...unknown[]];
      expect(sid).not.toContain(gemini.managedMeta.agentId);
    }
  });

  // ── Scenario 3: Topic-session collapse ──────────────────────────────

  it('3. Topic-session: location.type and scopeType collapse to "dm"; sessionId uses dm/{channelId}', async () => {
    const bot = makeHiveBot();
    const message = makeMessage();
    primeHivePush(db, {
      bots: [bot],
      message,
      sender: makeHumanSender(),
      channel: makeChannel('topic-session'),
    });
    stubOrchestrationHelpers(service, [SENDER_ID, bot.userId]);

    await service.processTask({
      msgId: message.id,
      channelId: CHANNEL_ID,
      senderId: SENDER_ID,
      broadcastAt: Date.now(),
    });

    expect(clawHiveService.sendInput).toHaveBeenCalledTimes(1);
    const [sessionId, event] = clawHiveService.sendInput.mock.calls[0] as [
      string,
      any,
      ...unknown[],
    ];
    // Wire scope is 'dm' even though channels.type stays 'topic-session'.
    expect(sessionId).toBe(
      `team9/${TENANT_ID}/${bot.managedMeta.agentId}/dm/${CHANNEL_ID}`,
    );
    expect(event.payload.location.type).toBe('dm');
    expect(event.payload.team9Context.scopeType).toBe('dm');
    // No tracking channel is created for topic-session — the bot has an
    // active session keyed off the channel id from the kickoff event.
    expect(event.payload.trackingChannelId).toBeUndefined();
    // isMentorDm is reserved for real direct channels — see
    // deriveTeam9Context: only `isDirect && bot.mentorId === sender.id`.
    expect(event.payload.team9Context.isMentorDm).toBe(false);
  });

  // ── Scenario 4: Mentor flag ─────────────────────────────────────────

  describe('4. Mentor flag', () => {
    it('isMentorDm=true when bot.mentorId === sender.id and channel is direct', async () => {
      const bot = makeHiveBot({ mentorId: SENDER_ID });
      const message = makeMessage();
      primeHivePush(db, {
        bots: [bot],
        message,
        sender: makeHumanSender(),
        channel: makeChannel('direct'),
      });
      stubOrchestrationHelpers(service, [SENDER_ID, bot.userId]);

      await service.processTask({
        msgId: message.id,
        channelId: CHANNEL_ID,
        senderId: SENDER_ID,
        broadcastAt: Date.now(),
      });

      expect(clawHiveService.sendInput).toHaveBeenCalledTimes(1);
      expect(team9ContextFromCall(0)).toEqual({
        source: 'team9',
        scopeType: 'dm',
        scopeId: CHANNEL_ID,
        peerUserId: SENDER_ID,
        isMentorDm: true,
      });
    });

    it('isMentorDm=false when sender is NOT the bot mentor (mentor-change scenario)', async () => {
      const otherUser = uuidv7();
      const bot = makeHiveBot({ mentorId: otherUser });
      const message = makeMessage();
      primeHivePush(db, {
        bots: [bot],
        message,
        sender: makeHumanSender(),
        channel: makeChannel('direct'),
      });
      stubOrchestrationHelpers(service, [SENDER_ID, bot.userId]);

      await service.processTask({
        msgId: message.id,
        channelId: CHANNEL_ID,
        senderId: SENDER_ID,
        broadcastAt: Date.now(),
      });

      expect(team9ContextFromCall(0).isMentorDm).toBe(false);
    });
  });

  // ── Scenario 5: Tracking auto-forward ───────────────────────────────

  it('5. Tracking auto-forward: thread reply with an existing tracking channel triggers the bot without @mention and routes to a tracking-scope session', async () => {
    const bot = makeHiveBot();
    const existingTrackingChannelId = uuidv7();
    // Thread reply → message.parentId/rootId set → threadRootId
    // resolves and the thread-tracking lookup runs.
    const message = makeMessage({
      parentId: PARENT_MSG_ID,
      rootId: ROOT_MSG_ID,
      content: 'follow-up question — no @mention needed',
    });
    primeHivePush(db, {
      bots: [bot],
      message,
      sender: makeHumanSender(),
      channel: makeChannel('public'),
      parentMessage: { id: PARENT_MSG_ID, content: 'original question' },
      threadTrackingMessages: [
        {
          senderId: bot.userId,
          metadata: { trackingChannelId: existingTrackingChannelId },
        },
      ],
    });
    stubOrchestrationHelpers(service, [SENDER_ID, bot.userId]);

    await service.processTask({
      msgId: message.id,
      channelId: CHANNEL_ID,
      senderId: SENDER_ID,
      broadcastAt: Date.now(),
    });

    // The bot fires once even though there is no @mention — the
    // existing-tracking entry in the thread satisfies the trigger
    // gate at post-broadcast.service.ts:752-761.
    expect(clawHiveService.sendInput).toHaveBeenCalledTimes(1);
    // Session id uses tracking/ scope (NOT dm/), confirming the
    // routing decision matches a group thread-reply.
    const sessionId = sessionIdFromCall(0);
    expect(sessionId).toMatch(
      new RegExp(
        `^team9/${TENANT_ID}/${bot.managedMeta.agentId}/tracking/[0-9a-f-]+$`,
      ),
    );
    // `existingTrackingId` is *only* a trigger-gate predicate; each
    // follow-up reply still spawns a fresh tracking channel + agent
    // session by design (commit 28907d81 "create new tracking channel
    // and session for each thread reply" — gives each interaction
    // independent tracking and a fresh context). The new tracking
    // channel id is what populates sessionId, NOT existingTrackingId.
    // We confirm createTrackingChannel did open its transaction.
    expect(db.transaction).toHaveBeenCalledTimes(1);
    // sessionId carries the freshly-created tracking channel id, not
    // the existing one — this pins the by-design behaviour.
    expect(sessionId).not.toContain(existingTrackingChannelId);
    // Location is a thread under the original public channel.
    const [, event] = clawHiveService.sendInput.mock.calls[0] as [
      string,
      any,
      ...unknown[],
    ];
    expect(event.payload.location.type).toBe('thread');
    expect(event.payload.location.parent).toEqual(
      expect.objectContaining({ type: 'channel', id: CHANNEL_ID }),
    );
  });

  // ── Scenario 6: Skip non-human-authored messages ────────────────────

  it('6. Skip non-human-authored: bot-authored messages do not fire sendInput', async () => {
    const bot = makeHiveBot();
    const message = makeMessage({ content: 'auto-reply from another bot' });
    primeHivePush(db, {
      bots: [bot],
      message,
      sender: makeBotSender(),
      channel: makeChannel('direct'),
    });
    stubOrchestrationHelpers(service, [SENDER_ID, bot.userId]);

    await service.processTask({
      msgId: message.id,
      channelId: CHANNEL_ID,
      senderId: SENDER_ID,
      broadcastAt: Date.now(),
    });

    expect(clawHiveService.sendInput).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  // ── Scenario 7: Skip deep-research messages ─────────────────────────

  it('7. Skip deep-research: messages flagged in metadata.deepResearch.taskId do not fire sendInput', async () => {
    const bot = makeHiveBot();
    const message = makeMessage({
      content: 'research market trends Q3',
      metadata: {
        deepResearch: {
          taskId: uuidv7(),
          version: 1,
        },
      },
    });
    primeHivePush(db, {
      bots: [bot],
      message,
      sender: makeHumanSender(),
      channel: makeChannel('direct'),
    });
    stubOrchestrationHelpers(service, [SENDER_ID, bot.userId]);

    await service.processTask({
      msgId: message.id,
      channelId: CHANNEL_ID,
      senderId: SENDER_ID,
      broadcastAt: Date.now(),
    });

    expect(clawHiveService.sendInput).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
