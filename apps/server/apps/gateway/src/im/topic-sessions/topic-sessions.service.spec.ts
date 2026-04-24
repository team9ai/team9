import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DATABASE_CONNECTION } from '@team9/database';
import { ClawHiveService } from '@team9/claw-hive';
import { GatewayMQService } from '@team9/rabbitmq';

// Mock WebsocketGateway before any module that transitively imports it is
// evaluated. The real WebsocketGateway uses `@WebSocketGateway({ cors: {
// origin: env.CORS_ORIGIN ... } })` which reads env.CORS_ORIGIN at
// module-load time — that throws in CI where the env var isn't set, and
// the failure propagates up through every module that imports the file.
// TopicSessionsService + ChannelsService both have a (forward-ref'd)
// dependency on WebsocketGateway, so stubbing once here keeps both specs
// off the real decorator path. Matches the pattern in
// channels.controller.spec.ts et al.
jest.unstable_mockModule('../websocket/websocket.gateway.js', () => ({
  WebsocketGateway: class WebsocketGateway {},
}));

// Dynamic imports after the mock so the mocked module is in place by the
// time TopicSessionsService's module graph is evaluated.
const { TopicSessionsService } = await import('./topic-sessions.service.js');
const { ChannelsService } = await import('../channels/channels.service.js');
const { WebsocketGateway } = await import('../websocket/websocket.gateway.js');
const { ImWorkerGrpcClientService } =
  await import('../services/im-worker-grpc-client.service.js');

// --------------------------------------------------------------------
// Test helpers
// --------------------------------------------------------------------

type MockFn = jest.Mock<(...args: any[]) => any>;

/**
 * Minimal Drizzle-like query-chain mock. Each method returns the same
 * chain so tests can push per-call results via `.mockResolvedValueOnce`
 * on the tail method (usually `limit`, `where`, `groupBy`, ...).
 */
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
    'innerJoin',
    'leftJoin',
    'orderBy',
    'offset',
    'groupBy',
    'having',
    'delete',
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  // Defaults only for methods that always TERMINATE the chain (return
  // a Promise). `where` / `groupBy` sometimes terminate and sometimes
  // keep chaining, so we leave them as pass-through and let individual
  // tests override with `.mockResolvedValueOnce([...])` when needed.
  chain.limit.mockResolvedValue([]);
  chain.returning.mockResolvedValue([]);
  return chain;
}

const TENANT_ID = 'tenant-1';
const CREATOR_ID = '00000000-0000-0000-0000-000000000001';
const BOT_USER_ID = '00000000-0000-0000-0000-000000000002';
const AGENT_ID = 'agent-alpha';

function makeHiveBotRow(): any {
  return {
    userId: BOT_USER_ID,
    managedProvider: 'hive',
    managedMeta: { agentId: AGENT_ID },
    isActive: true,
    userType: 'bot',
  };
}

function makeTopicChannelRow(channelId: string): any {
  return {
    id: channelId,
    tenantId: TENANT_ID,
    name: null,
    description: null,
    type: 'topic-session',
    avatarUrl: null,
    createdBy: CREATOR_ID,
    sectionId: null,
    order: 0,
    isArchived: false,
    isActivated: true,
    snapshot: null,
    createdAt: new Date('2026-04-23T00:00:00.000Z'),
    updatedAt: new Date('2026-04-23T00:00:00.000Z'),
  };
}

// --------------------------------------------------------------------
// Suite
// --------------------------------------------------------------------

describe('TopicSessionsService', () => {
  let service: TopicSessionsService;
  let db: ReturnType<typeof mockDb>;
  let clawHive: {
    createSession: MockFn;
    deleteSession: MockFn;
    updateSessionTitle: MockFn;
  };
  let channels: {
    assertDirectMessageAllowed: MockFn;
    createTopicSessionChannel: MockFn;
    updateTopicSessionTitle: MockFn;
  };
  let imWorkerGrpc: { createMessage: MockFn };
  let ws: { sendToUser: MockFn };
  let gatewayMQ: { isReady: MockFn; publishPostBroadcast: MockFn };
  let eventEmitter: { emit: MockFn };

  beforeEach(async () => {
    db = mockDb();

    clawHive = {
      createSession: jest
        .fn<any>()
        .mockResolvedValue({ sessionId: 'will-be-overridden' }),
      deleteSession: jest.fn<any>().mockResolvedValue(undefined),
      updateSessionTitle: jest.fn<any>().mockResolvedValue(undefined),
    };
    channels = {
      assertDirectMessageAllowed: jest.fn<any>().mockResolvedValue(undefined),
      createTopicSessionChannel: jest.fn<any>(),
      updateTopicSessionTitle: jest.fn<any>().mockResolvedValue(undefined),
    };
    imWorkerGrpc = {
      createMessage: jest.fn<any>().mockResolvedValue({ msgId: 'msg-1' }),
    };
    ws = { sendToUser: jest.fn<any>().mockResolvedValue(undefined) };
    gatewayMQ = {
      isReady: jest.fn<any>().mockReturnValue(true),
      publishPostBroadcast: jest.fn<any>().mockResolvedValue(undefined),
    };
    eventEmitter = { emit: jest.fn<any>() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicSessionsService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: ClawHiveService, useValue: clawHive },
        { provide: ChannelsService, useValue: channels },
        { provide: ImWorkerGrpcClientService, useValue: imWorkerGrpc },
        { provide: WebsocketGateway, useValue: ws },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: GatewayMQService, useValue: gatewayMQ },
      ],
    }).compile();

    service = module.get(TopicSessionsService);
  });

  // ------------------------------------------------------------------
  // create()
  // ------------------------------------------------------------------

  describe('create', () => {
    it('creates agent-pi session + channel + first message, returns ids', async () => {
      // Step 1: bot lookup returns a valid hive bot
      db.limit.mockResolvedValueOnce([makeHiveBotRow()]);

      // Step 5: createTopicSessionChannel returns fake channel
      channels.createTopicSessionChannel.mockImplementationOnce(
        async ({ channelId }: any) =>
          makeTopicChannelRow(channelId ?? 'generated'),
      );

      const result = await service.create({
        creatorId: CREATOR_ID,
        tenantId: TENANT_ID,
        botUserId: BOT_USER_ID,
        initialMessage: 'Hello agent, help me kick off a new topic',
      });

      expect(result.agentId).toBe(AGENT_ID);
      expect(result.botUserId).toBe(BOT_USER_ID);
      // Topic sessions share the 'dm' wire scope with direct and
      // routine-session (agent-pi's EventChannelType is a closed enum;
      // the topic-session distinction lives on team9 channels.type).
      expect(result.sessionId).toBe(
        `team9/${TENANT_ID}/${AGENT_ID}/dm/${result.channelId}`,
      );
      expect(result.title).toBeNull();

      // Ordering invariants:
      expect(channels.assertDirectMessageAllowed).toHaveBeenCalledWith(
        CREATOR_ID,
        BOT_USER_ID,
      );
      expect(clawHive.createSession).toHaveBeenCalledWith(
        AGENT_ID,
        expect.objectContaining({
          userId: CREATOR_ID,
          sessionId: result.sessionId,
          team9Context: expect.objectContaining({
            scopeType: 'dm',
            scopeId: result.channelId,
          }),
        }),
        TENANT_ID,
      );
      expect(channels.createTopicSessionChannel).toHaveBeenCalledWith(
        expect.objectContaining({
          creatorId: CREATOR_ID,
          botUserId: BOT_USER_ID,
          agentId: AGENT_ID,
          sessionId: result.sessionId,
          channelId: result.channelId,
        }),
      );
      expect(imWorkerGrpc.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: result.channelId,
          senderId: CREATOR_ID,
          content: 'Hello agent, help me kick off a new topic',
        }),
      );
      expect(gatewayMQ.publishPostBroadcast).toHaveBeenCalled();
      expect(ws.sendToUser).toHaveBeenCalledWith(
        CREATOR_ID,
        'topic_session_created',
        expect.objectContaining({
          channelId: result.channelId,
          sessionId: result.sessionId,
        }),
      );
    });

    it('rejects when the target user is not an active hive-managed agent', async () => {
      db.limit.mockResolvedValueOnce([]); // no bot found

      await expect(
        service.create({
          creatorId: CREATOR_ID,
          tenantId: TENANT_ID,
          botUserId: BOT_USER_ID,
          initialMessage: 'hi',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(clawHive.createSession).not.toHaveBeenCalled();
      expect(channels.createTopicSessionChannel).not.toHaveBeenCalled();
    });

    it('rejects when bot has no agentId in managedMeta', async () => {
      db.limit.mockResolvedValueOnce([
        { ...makeHiveBotRow(), managedMeta: {} },
      ]);

      await expect(
        service.create({
          creatorId: CREATOR_ID,
          tenantId: TENANT_ID,
          botUserId: BOT_USER_ID,
          initialMessage: 'hi',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(clawHive.createSession).not.toHaveBeenCalled();
    });

    it('compensates the agent-pi session when channel creation fails', async () => {
      db.limit.mockResolvedValueOnce([makeHiveBotRow()]);
      channels.createTopicSessionChannel.mockRejectedValueOnce(
        new Error('DB down'),
      );

      await expect(
        service.create({
          creatorId: CREATOR_ID,
          tenantId: TENANT_ID,
          botUserId: BOT_USER_ID,
          initialMessage: 'hi',
        }),
      ).rejects.toThrow('DB down');

      expect(clawHive.createSession).toHaveBeenCalled();
      // Compensation runs fire-and-forget; allow microtasks to flush.
      await new Promise((resolve) => setImmediate(resolve));
      expect(clawHive.deleteSession).toHaveBeenCalledTimes(1);
      const [sessionIdArg] = clawHive.deleteSession.mock.calls[0] ?? [];
      expect(sessionIdArg).toMatch(
        new RegExp(`^team9/${TENANT_ID}/${AGENT_ID}/dm/`),
      );
    });

    it('compensates channel + session when gRPC createMessage fails', async () => {
      db.limit.mockResolvedValueOnce([makeHiveBotRow()]);
      channels.createTopicSessionChannel.mockImplementationOnce(
        async ({ channelId }: any) =>
          makeTopicChannelRow(channelId ?? 'generated'),
      );
      imWorkerGrpc.createMessage.mockRejectedValueOnce(
        new Error('worker offline'),
      );

      await expect(
        service.create({
          creatorId: CREATOR_ID,
          tenantId: TENANT_ID,
          botUserId: BOT_USER_ID,
          initialMessage: 'hi',
        }),
      ).rejects.toThrow('worker offline');

      await new Promise((resolve) => setImmediate(resolve));
      // Session compensation still runs.
      expect(clawHive.deleteSession).toHaveBeenCalledTimes(1);
      // Channel compensation triggers the delete chain.
      expect(db.delete).toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // delete()
  // ------------------------------------------------------------------

  describe('delete', () => {
    const CHANNEL_ID = '00000000-0000-0000-0000-0000000000aa';
    const SESSION_ID = `team9/${TENANT_ID}/${AGENT_ID}/dm/${CHANNEL_ID}`;

    it('archives the channel and best-effort deletes the agent-pi session', async () => {
      db.limit.mockResolvedValueOnce([
        {
          id: CHANNEL_ID,
          type: 'topic-session',
          isArchived: false,
          propertySettings: {
            topicSession: { sessionId: SESSION_ID, agentId: AGENT_ID },
          },
          createdBy: CREATOR_ID,
        },
      ]);

      await service.delete({
        userId: CREATOR_ID,
        tenantId: TENANT_ID,
        channelId: CHANNEL_ID,
      });

      expect(db.update).toHaveBeenCalled();
      await new Promise((resolve) => setImmediate(resolve));
      expect(clawHive.deleteSession).toHaveBeenCalledWith(
        SESSION_ID,
        TENANT_ID,
      );
      expect(ws.sendToUser).toHaveBeenCalledWith(
        CREATOR_ID,
        'topic_session_deleted',
        { channelId: CHANNEL_ID },
      );
    });

    it('throws 404 when the channel is not a topic-session', async () => {
      db.limit.mockResolvedValueOnce([{ id: CHANNEL_ID, type: 'direct' }]);

      await expect(
        service.delete({
          userId: CREATOR_ID,
          tenantId: TENANT_ID,
          channelId: CHANNEL_ID,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 403 when caller is not the creator', async () => {
      db.limit.mockResolvedValueOnce([
        {
          id: CHANNEL_ID,
          type: 'topic-session',
          isArchived: false,
          propertySettings: { topicSession: { sessionId: SESSION_ID } },
          createdBy: 'someone-else',
        },
      ]);

      await expect(
        service.delete({
          userId: CREATOR_ID,
          tenantId: TENANT_ID,
          channelId: CHANNEL_ID,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(db.update).not.toHaveBeenCalled();
      expect(clawHive.deleteSession).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // listGrouped()
  // ------------------------------------------------------------------

  describe('listGrouped', () => {
    it('returns empty list when the user has no topic or legacy channels', async () => {
      // topic-sessions query resolves to empty → short-circuits into
      // the legacy-direct-only fallback, which also resolves empty.
      db.where
        .mockResolvedValueOnce([]) // listGrouped: topic-session channels
        .mockResolvedValueOnce([]); // listLegacyDirectOnly: direct channels

      const result = await service.listGrouped(CREATOR_ID, TENANT_ID, 5);
      expect(result).toEqual([]);
    });
  });
});
