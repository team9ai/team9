import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { UpstreamConsumer } from './upstream.consumer.js';
import { MessageService } from '../message/message.service.js';
import { MessageRouterService } from '../message/message-router.service.js';
import { AckService } from '../ack/ack.service.js';
import { AmqpConnection } from '@team9/rabbitmq';
import type { UpstreamMessage, IMMessageEnvelope } from '@team9/shared';

describe('UpstreamConsumer', () => {
  let consumer: UpstreamConsumer;
  let messageService: jest.Mocked<MessageService>;
  let routerService: jest.Mocked<MessageRouterService>;
  let ackService: jest.Mocked<AckService>;

  const mockChannel = {
    assertExchange: jest.fn().mockResolvedValue(undefined),
    assertQueue: jest.fn().mockResolvedValue({ queue: 'test-queue' }),
    bindQueue: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockResolvedValue({ consumerTag: 'test-consumer' }),
    ack: jest.fn(),
    nack: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpstreamConsumer,
        {
          provide: AmqpConnection,
          useValue: {
            channel: mockChannel,
          },
        },
        {
          provide: MessageService,
          useValue: {
            processUpstreamMessage: jest.fn(),
            getUndeliveredMessages: jest.fn(),
          },
        },
        {
          provide: AckService,
          useValue: {
            handleClientAck: jest.fn(),
            handleReadStatus: jest.fn(),
          },
        },
        {
          provide: MessageRouterService,
          useValue: {
            sendToGateway: jest.fn(),
            routeMessage: jest.fn(),
          },
        },
      ],
    }).compile();

    consumer = module.get<UpstreamConsumer>(UpstreamConsumer);
    messageService = module.get(MessageService);
    routerService = module.get(MessageRouterService);
    ackService = module.get(AckService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handlePresenceMessage', () => {
    const createPresenceMessage = (
      event: 'online' | 'offline',
    ): UpstreamMessage => ({
      gatewayId: 'gateway-123',
      userId: 'user-456',
      socketId: 'socket-789',
      message: {
        msgId: 'msg-1',
        type: 'presence',
        senderId: 'user-456',
        targetType: 'user',
        targetId: 'user-456',
        payload: { event },
        timestamp: Date.now(),
      },
      receivedAt: Date.now(),
    });

    it('should deliver unread messages when user comes online', async () => {
      const upstream = createPresenceMessage('online');
      const mockMessages: IMMessageEnvelope[] = [
        {
          msgId: 'unread-1',
          type: 'text',
          senderId: 'other-user',
          targetType: 'channel',
          targetId: 'channel-1',
          payload: { content: 'Hello' },
          timestamp: Date.now(),
        },
        {
          msgId: 'unread-2',
          type: 'text',
          senderId: 'another-user',
          targetType: 'channel',
          targetId: 'channel-2',
          payload: { content: 'World' },
          timestamp: Date.now(),
        },
      ];

      messageService.getUndeliveredMessages.mockResolvedValue(mockMessages);
      routerService.sendToGateway.mockResolvedValue(undefined);

      // Access private method through any cast
      await (consumer as any).handlePresenceMessage(upstream);

      expect(messageService.getUndeliveredMessages).toHaveBeenCalledWith(
        'user-456',
      );
      expect(routerService.sendToGateway).toHaveBeenCalledTimes(2);
      expect(routerService.sendToGateway).toHaveBeenCalledWith(
        'gateway-123',
        mockMessages[0],
        ['user-456'],
      );
      expect(routerService.sendToGateway).toHaveBeenCalledWith(
        'gateway-123',
        mockMessages[1],
        ['user-456'],
      );
    });

    it('should not call sendToGateway when no unread messages', async () => {
      const upstream = createPresenceMessage('online');

      messageService.getUndeliveredMessages.mockResolvedValue([]);

      await (consumer as any).handlePresenceMessage(upstream);

      expect(messageService.getUndeliveredMessages).toHaveBeenCalledWith(
        'user-456',
      );
      expect(routerService.sendToGateway).not.toHaveBeenCalled();
    });

    it('should not fetch messages for offline event', async () => {
      const upstream = createPresenceMessage('offline');

      await (consumer as any).handlePresenceMessage(upstream);

      expect(messageService.getUndeliveredMessages).not.toHaveBeenCalled();
      expect(routerService.sendToGateway).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      const upstream = createPresenceMessage('online');

      messageService.getUndeliveredMessages.mockRejectedValue(
        new Error('Database error'),
      );

      // Should not throw
      await expect(
        (consumer as any).handlePresenceMessage(upstream),
      ).resolves.not.toThrow();
    });
  });

  describe('handleAckMessage', () => {
    it('should delegate to ackService', async () => {
      const upstream: UpstreamMessage = {
        gatewayId: 'gateway-123',
        userId: 'user-456',
        socketId: 'socket-789',
        message: {
          msgId: 'msg-1',
          type: 'ack',
          senderId: 'user-456',
          targetType: 'message',
          targetId: 'original-msg-id',
          payload: { msgId: 'original-msg-id', ackType: 'delivered' },
          timestamp: Date.now(),
        },
        receivedAt: Date.now(),
      };

      await (consumer as any).handleAckMessage(upstream);

      expect(ackService.handleClientAck).toHaveBeenCalledWith(upstream);
    });
  });

  describe('handleReadMessage', () => {
    it('should delegate to ackService', async () => {
      const upstream: UpstreamMessage = {
        gatewayId: 'gateway-123',
        userId: 'user-456',
        socketId: 'socket-789',
        message: {
          msgId: 'msg-1',
          type: 'read',
          senderId: 'user-456',
          targetType: 'channel',
          targetId: 'channel-123',
          payload: { lastReadMsgId: 'msg-100' },
          timestamp: Date.now(),
        },
        receivedAt: Date.now(),
      };

      await (consumer as any).handleReadMessage(upstream);

      expect(ackService.handleReadStatus).toHaveBeenCalledWith(upstream);
    });
  });

  describe('message type routing', () => {
    it('should route text messages to handleContentMessage', async () => {
      const upstream: UpstreamMessage = {
        gatewayId: 'gateway-123',
        userId: 'user-456',
        socketId: 'socket-789',
        message: {
          msgId: 'msg-1',
          type: 'text',
          senderId: 'user-456',
          targetType: 'channel',
          targetId: 'channel-123',
          payload: { content: 'Hello' },
          timestamp: Date.now(),
        },
        receivedAt: Date.now(),
      };

      messageService.processUpstreamMessage.mockResolvedValue({
        msgId: 'msg-1',
        status: 'ok',
        serverTime: Date.now(),
      });

      await (consumer as any).handleUpstreamMessage(upstream);

      expect(messageService.processUpstreamMessage).toHaveBeenCalledWith(
        upstream,
      );
    });

    it('should route presence messages to handlePresenceMessage', async () => {
      const upstream: UpstreamMessage = {
        gatewayId: 'gateway-123',
        userId: 'user-456',
        socketId: 'socket-789',
        message: {
          msgId: 'msg-1',
          type: 'presence',
          senderId: 'user-456',
          targetType: 'user',
          targetId: 'user-456',
          payload: { event: 'online' },
          timestamp: Date.now(),
        },
        receivedAt: Date.now(),
      };

      messageService.getUndeliveredMessages.mockResolvedValue([]);

      await (consumer as any).handleUpstreamMessage(upstream);

      expect(messageService.getUndeliveredMessages).toHaveBeenCalled();
    });
  });
});
