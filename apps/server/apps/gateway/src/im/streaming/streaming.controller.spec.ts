import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

// ── Module mocks (BEFORE any dynamic imports) ────────────────────────────────

jest.unstable_mockModule('uuid', () => ({
  v7: jest.fn(() => 'mock-stream-id'),
}));

// Mock WebsocketGateway module to avoid env var side-effects at import time
jest.unstable_mockModule('../websocket/websocket.gateway.js', () => ({
  WebsocketGateway: class WebsocketGateway {},
}));

// Dynamic import AFTER mocking
const { StreamingController } = await import('./streaming.controller.js');
const { WebsocketGateway } = await import('../websocket/websocket.gateway.js');
const uuid = await import('uuid');

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, Logger } from '@nestjs/common';
import { RedisService } from '@team9/redis';
import { GatewayMQService } from '@team9/rabbitmq';
import { ChannelsService } from '../channels/channels.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { ImWorkerGrpcClientService } from '../services/im-worker-grpc-client.service.js';
import { BotService } from '../../bot/bot.service.js';
import { WS_EVENTS } from '../websocket/events/events.constants.js';
import { REDIS_KEYS } from '../shared/constants/redis-keys.js';

// ── helpers ──────────────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

// ── fixtures ─────────────────────────────────────────────────────────────────

const BOT_USER_ID = 'bot-user-id-001';
const OTHER_USER_ID = 'other-user-id-002';
const NON_BOT_USER_ID = 'human-user-id-003';
const CHANNEL_ID = 'channel-uuid-abc';
const STREAM_ID = 'mock-stream-id';
const CLIENT_MSG_ID = 'mock-client-msg-id';
const PARENT_ID = 'parent-msg-uuid';
const MSG_ID = 'persisted-msg-id-777';

const makeSession = (overrides: Record<string, any> = {}) => ({
  channelId: CHANNEL_ID,
  senderId: BOT_USER_ID,
  parentId: PARENT_ID,
  startedAt: 1700000000000,
  ...overrides,
});

const makeMessage = () => ({
  id: MSG_ID,
  channelId: CHANNEL_ID,
  senderId: BOT_USER_ID,
  content: 'Hello world',
  type: 'text',
  parentId: PARENT_ID,
});

// ── tests ────────────────────────────────────────────────────────────────────

describe('StreamingController', () => {
  let controller: InstanceType<typeof StreamingController>;

  let redisService: {
    set: MockFn;
    get: MockFn;
    del: MockFn;
    sadd: MockFn;
    srem: MockFn;
    expire: MockFn;
  };
  let websocketGateway: { sendToChannel: MockFn };
  let channelsService: { isMember: MockFn; findById: MockFn };
  let messagesService: { getMessageWithDetails: MockFn };
  let imWorkerGrpcClientService: { createMessage: MockFn };
  let botService: { isBot: MockFn };
  let gatewayMQService: { publishPostBroadcast: MockFn; isReady: MockFn };

  let dateSpy: jest.Spied<typeof Date.now>;

  beforeEach(async () => {
    redisService = {
      set: jest.fn<any>().mockResolvedValue(undefined),
      get: jest.fn<any>().mockResolvedValue(null),
      del: jest.fn<any>().mockResolvedValue(undefined),
      sadd: jest.fn<any>().mockResolvedValue(undefined),
      srem: jest.fn<any>().mockResolvedValue(undefined),
      expire: jest.fn<any>().mockResolvedValue(undefined),
    };

    websocketGateway = {
      sendToChannel: jest.fn<any>(),
    };

    channelsService = {
      isMember: jest.fn<any>().mockResolvedValue(true),
      findById: jest.fn<any>().mockResolvedValue({ tenantId: 'workspace-1' }),
    };

    messagesService = {
      getMessageWithDetails: jest.fn<any>().mockResolvedValue(makeMessage()),
    };

    imWorkerGrpcClientService = {
      createMessage: jest.fn<any>().mockResolvedValue({ msgId: MSG_ID }),
    };

    botService = {
      isBot: jest.fn<any>().mockResolvedValue(true),
    };

    gatewayMQService = {
      publishPostBroadcast: jest.fn<any>().mockResolvedValue(undefined),
      isReady: jest.fn<any>().mockReturnValue(true),
    };

    dateSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StreamingController],
      providers: [
        { provide: RedisService, useValue: redisService },
        { provide: WebsocketGateway, useValue: websocketGateway },
        { provide: ChannelsService, useValue: channelsService },
        { provide: MessagesService, useValue: messagesService },
        {
          provide: ImWorkerGrpcClientService,
          useValue: imWorkerGrpcClientService,
        },
        { provide: BotService, useValue: botService },
        { provide: GatewayMQService, useValue: gatewayMQService },
      ],
    }).compile();

    controller = module.get(StreamingController);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  // ── startStreaming ───────────────────────────────────────────────────────────

  describe('startStreaming', () => {
    it('creates Redis session, broadcasts streaming_start, and returns streamId', async () => {
      const result = await controller.startStreaming(BOT_USER_ID, CHANNEL_ID, {
        parentId: PARENT_ID,
      });

      // Returns the mocked stream ID
      expect(result).toEqual({ streamId: STREAM_ID });

      // Stores session in Redis with TTL 120
      expect(redisService.set).toHaveBeenCalledWith(
        REDIS_KEYS.STREAMING_SESSION(STREAM_ID),
        JSON.stringify({
          channelId: CHANNEL_ID,
          senderId: BOT_USER_ID,
          parentId: PARENT_ID,
          startedAt: 1700000000000,
        }),
        120,
      );

      // Adds streamId to bot's active streams set
      expect(redisService.sadd).toHaveBeenCalledWith(
        REDIS_KEYS.BOT_ACTIVE_STREAMS(BOT_USER_ID),
        STREAM_ID,
      );

      // Sets TTL on the active streams set
      expect(redisService.expire).toHaveBeenCalledWith(
        REDIS_KEYS.BOT_ACTIVE_STREAMS(BOT_USER_ID),
        120,
      );

      // Broadcasts streaming_start to channel
      expect(websocketGateway.sendToChannel).toHaveBeenCalledWith(
        CHANNEL_ID,
        WS_EVENTS.STREAMING.START,
        {
          streamId: STREAM_ID,
          channelId: CHANNEL_ID,
          senderId: BOT_USER_ID,
          parentId: PARENT_ID,
          startedAt: 1700000000000,
        },
      );
    });

    it('works without parentId', async () => {
      const result = await controller.startStreaming(
        BOT_USER_ID,
        CHANNEL_ID,
        {},
      );

      expect(result).toEqual({ streamId: STREAM_ID });

      expect(redisService.set).toHaveBeenCalledWith(
        REDIS_KEYS.STREAMING_SESSION(STREAM_ID),
        JSON.stringify({
          channelId: CHANNEL_ID,
          senderId: BOT_USER_ID,
          parentId: undefined,
          startedAt: 1700000000000,
        }),
        120,
      );
    });

    it('rejects non-bot users with ForbiddenException', async () => {
      botService.isBot.mockResolvedValue(false);

      await expect(
        controller.startStreaming(NON_BOT_USER_ID, CHANNEL_ID, {}),
      ).rejects.toThrow(ForbiddenException);

      // Should not proceed to Redis or WS operations
      expect(redisService.set).not.toHaveBeenCalled();
      expect(websocketGateway.sendToChannel).not.toHaveBeenCalled();
    });

    it('rejects non-members with ForbiddenException', async () => {
      channelsService.isMember.mockResolvedValue(false);

      await expect(
        controller.startStreaming(BOT_USER_ID, CHANNEL_ID, {}),
      ).rejects.toThrow(ForbiddenException);

      // Should not proceed to Redis or WS operations
      expect(redisService.set).not.toHaveBeenCalled();
      expect(websocketGateway.sendToChannel).not.toHaveBeenCalled();
    });
  });

  // ── updateContent ────────────────────────────────────────────────────────────

  describe('updateContent', () => {
    it('refreshes TTL, broadcasts streaming_content, and returns success', async () => {
      redisService.get.mockResolvedValueOnce(JSON.stringify(makeSession()));

      const result = await controller.updateContent(BOT_USER_ID, STREAM_ID, {
        content: 'partial content...',
      });

      expect(result).toEqual({ success: true });

      // Refreshes session TTL
      expect(redisService.expire).toHaveBeenCalledWith(
        REDIS_KEYS.STREAMING_SESSION(STREAM_ID),
        120,
      );

      // Refreshes active streams TTL
      expect(redisService.expire).toHaveBeenCalledWith(
        REDIS_KEYS.BOT_ACTIVE_STREAMS(BOT_USER_ID),
        120,
      );

      // Broadcasts content to channel
      expect(websocketGateway.sendToChannel).toHaveBeenCalledWith(
        CHANNEL_ID,
        WS_EVENTS.STREAMING.CONTENT,
        {
          streamId: STREAM_ID,
          channelId: CHANNEL_ID,
          senderId: BOT_USER_ID,
          content: 'partial content...',
        },
      );
    });

    it('rejects non-bot users with ForbiddenException', async () => {
      botService.isBot.mockResolvedValue(false);

      await expect(
        controller.updateContent(NON_BOT_USER_ID, STREAM_ID, {
          content: 'test',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(redisService.get).not.toHaveBeenCalled();
    });

    it('rejects expired/missing session with ForbiddenException', async () => {
      // redisService.get returns null by default (no session found)
      await expect(
        controller.updateContent(BOT_USER_ID, STREAM_ID, {
          content: 'test',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(websocketGateway.sendToChannel).not.toHaveBeenCalled();
    });

    it('rejects non-owner with ForbiddenException', async () => {
      redisService.get.mockResolvedValueOnce(
        JSON.stringify(makeSession({ senderId: OTHER_USER_ID })),
      );

      await expect(
        controller.updateContent(BOT_USER_ID, STREAM_ID, {
          content: 'test',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(websocketGateway.sendToChannel).not.toHaveBeenCalled();
    });
  });

  // ── endStreaming ─────────────────────────────────────────────────────────────

  describe('endStreaming', () => {
    it('persists message, broadcasts streaming_end + new_message, cleans up Redis, and returns messageId', async () => {
      redisService.get.mockResolvedValueOnce(JSON.stringify(makeSession()));
      const message = makeMessage();
      messagesService.getMessageWithDetails.mockResolvedValueOnce(message);
      // Return a distinct value for the clientMsgId uuidv7() call inside endStreaming
      (uuid.v7 as unknown as jest.Mock<any>).mockReturnValueOnce(CLIENT_MSG_ID);

      const result = await controller.endStreaming(BOT_USER_ID, STREAM_ID, {
        content: 'Final content',
      });

      expect(result).toEqual({ success: true, messageId: MSG_ID });

      // Cleans up Redis session
      expect(redisService.del).toHaveBeenCalledWith(
        REDIS_KEYS.STREAMING_SESSION(STREAM_ID),
      );

      // Removes from active streams set
      expect(redisService.srem).toHaveBeenCalledWith(
        REDIS_KEYS.BOT_ACTIVE_STREAMS(BOT_USER_ID),
        STREAM_ID,
      );

      // Persists message via gRPC (clientMsgId is a fresh uuidv7(), distinct from streamId)
      expect(imWorkerGrpcClientService.createMessage).toHaveBeenCalledWith({
        clientMsgId: CLIENT_MSG_ID,
        channelId: CHANNEL_ID,
        senderId: BOT_USER_ID,
        content: 'Final content',
        parentId: PARENT_ID,
        type: 'text',
        workspaceId: 'workspace-1',
      });

      // Fetches persisted message with details
      expect(messagesService.getMessageWithDetails).toHaveBeenCalledWith(
        MSG_ID,
      );

      // Broadcasts streaming_end
      expect(websocketGateway.sendToChannel).toHaveBeenCalledWith(
        CHANNEL_ID,
        WS_EVENTS.STREAMING.END,
        {
          streamId: STREAM_ID,
          channelId: CHANNEL_ID,
          senderId: BOT_USER_ID,
          message,
        },
      );

      // Broadcasts new_message
      expect(websocketGateway.sendToChannel).toHaveBeenCalledWith(
        CHANNEL_ID,
        WS_EVENTS.MESSAGE.NEW,
        message,
      );
    });

    it('uses undefined workspaceId when channel has no tenantId', async () => {
      redisService.get.mockResolvedValueOnce(JSON.stringify(makeSession()));
      channelsService.findById.mockResolvedValueOnce({ tenantId: null });

      await controller.endStreaming(BOT_USER_ID, STREAM_ID, {
        content: 'Final',
      });

      expect(imWorkerGrpcClientService.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: undefined }),
      );
    });

    it('rejects non-bot users with ForbiddenException', async () => {
      botService.isBot.mockResolvedValue(false);

      await expect(
        controller.endStreaming(NON_BOT_USER_ID, STREAM_ID, {
          content: 'test',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(redisService.get).not.toHaveBeenCalled();
      expect(imWorkerGrpcClientService.createMessage).not.toHaveBeenCalled();
    });

    it('rejects expired/missing session with ForbiddenException', async () => {
      // redisService.get returns null by default
      await expect(
        controller.endStreaming(BOT_USER_ID, STREAM_ID, {
          content: 'test',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(imWorkerGrpcClientService.createMessage).not.toHaveBeenCalled();
    });

    it('rejects non-owner with ForbiddenException', async () => {
      redisService.get.mockResolvedValueOnce(
        JSON.stringify(makeSession({ senderId: OTHER_USER_ID })),
      );

      await expect(
        controller.endStreaming(BOT_USER_ID, STREAM_ID, {
          content: 'test',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(imWorkerGrpcClientService.createMessage).not.toHaveBeenCalled();
    });

    it('publishes post-broadcast task when gatewayMQService is available and ready', async () => {
      redisService.get.mockResolvedValueOnce(JSON.stringify(makeSession()));

      await controller.endStreaming(BOT_USER_ID, STREAM_ID, {
        content: 'Final content',
      });

      expect(gatewayMQService.publishPostBroadcast).toHaveBeenCalledWith({
        msgId: MSG_ID,
        channelId: CHANNEL_ID,
        senderId: BOT_USER_ID,
        workspaceId: 'workspace-1',
        broadcastAt: 1700000000000,
      });
    });

    it('does NOT publish post-broadcast task when gatewayMQService is not ready', async () => {
      redisService.get.mockResolvedValueOnce(JSON.stringify(makeSession()));
      gatewayMQService.isReady.mockReturnValueOnce(false);

      await controller.endStreaming(BOT_USER_ID, STREAM_ID, {
        content: 'Final content',
      });

      expect(gatewayMQService.publishPostBroadcast).not.toHaveBeenCalled();
    });

    it('does not throw when publishPostBroadcast fails (logs warning instead)', async () => {
      redisService.get.mockResolvedValueOnce(JSON.stringify(makeSession()));
      gatewayMQService.publishPostBroadcast.mockRejectedValueOnce(
        new Error('RabbitMQ connection lost'),
      );
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});

      // Should resolve successfully even though post-broadcast fails
      const result = await controller.endStreaming(BOT_USER_ID, STREAM_ID, {
        content: 'Final content',
      });

      expect(result).toEqual({ success: true, messageId: MSG_ID });

      // Flush the microtask queue so the .catch() handler runs
      await new Promise((r) => setImmediate(r));

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to publish post-broadcast task'),
      );
      warnSpy.mockRestore();
    });
  });

  // ── GatewayMQService undefined ──────────────────────────────────────────────

  describe('when GatewayMQService is undefined', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        controllers: [StreamingController],
        providers: [
          { provide: RedisService, useValue: redisService },
          { provide: WebsocketGateway, useValue: websocketGateway },
          { provide: ChannelsService, useValue: channelsService },
          { provide: MessagesService, useValue: messagesService },
          {
            provide: ImWorkerGrpcClientService,
            useValue: imWorkerGrpcClientService,
          },
          { provide: BotService, useValue: botService },
          // GatewayMQService NOT provided — @Optional() means it stays undefined
        ],
      }).compile();

      controller = module.get(StreamingController);
    });

    it('endStreaming succeeds without publishing post-broadcast task', async () => {
      redisService.get.mockResolvedValueOnce(JSON.stringify(makeSession()));

      const result = await controller.endStreaming(BOT_USER_ID, STREAM_ID, {
        content: 'Final content',
      });

      expect(result).toEqual({ success: true, messageId: MSG_ID });
      // gatewayMQService is undefined so publishPostBroadcast is never called
      expect(gatewayMQService.publishPostBroadcast).not.toHaveBeenCalled();
    });
  });
});
