import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { UpstreamConsumer } from './upstream.consumer.js';

describe('UpstreamConsumer', () => {
  let consumer: UpstreamConsumer;
  let messageService: {
    processUpstreamMessage: jest.Mock<any>;
  };
  let ackService: {
    handleClientAck: jest.Mock<any>;
    handleReadStatus: jest.Mock<any>;
  };
  let postBroadcastService:
    | {
        processTask: jest.Mock<any>;
      }
    | undefined;

  beforeEach(() => {
    messageService = {
      processUpstreamMessage: jest.fn<any>().mockResolvedValue({
        msgId: 'msg-1',
        status: 'ok',
      }),
    };
    ackService = {
      handleClientAck: jest.fn<any>().mockResolvedValue(undefined),
      handleReadStatus: jest.fn<any>().mockResolvedValue(undefined),
    };
    postBroadcastService = {
      processTask: jest.fn<any>().mockResolvedValue(undefined),
    };

    consumer = new UpstreamConsumer(
      messageService as any,
      ackService as any,
      postBroadcastService as any,
    );
    (consumer as any).logger = {
      debug: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  function makeUpstream(type: string, payload: Record<string, unknown> = {}) {
    return {
      gatewayId: 'gateway-1',
      userId: 'user-1',
      socketId: 'socket-1',
      receivedAt: 1234567890,
      message: {
        msgId: 'msg-1',
        clientMsgId: 'client-msg-1',
        senderId: 'user-1',
        targetType: 'channel',
        targetId: 'channel-1',
        type: type as any,
        payload,
        timestamp: 1234567890,
      },
    };
  }

  it.each(['text', 'file', 'image', 'system'] as const)(
    'dispatches %s messages to MessageService',
    async (type) => {
      const upstream = makeUpstream(type, { content: 'hello' });

      await expect(
        consumer.handleUpstreamMessage(upstream as any),
      ).resolves.toBeUndefined();

      expect(messageService.processUpstreamMessage).toHaveBeenCalledWith(
        upstream,
      );
      expect(ackService.handleClientAck).not.toHaveBeenCalled();
      expect(ackService.handleReadStatus).not.toHaveBeenCalled();
    },
  );

  it('dispatches ack messages to AckService.handleClientAck', async () => {
    const upstream = makeUpstream('ack', {
      msgId: 'msg-ack',
      ackType: 'delivered',
    });

    await expect(
      consumer.handleUpstreamMessage(upstream as any),
    ).resolves.toBeUndefined();

    expect(ackService.handleClientAck).toHaveBeenCalledWith(upstream);
    expect(messageService.processUpstreamMessage).not.toHaveBeenCalled();
    expect(ackService.handleReadStatus).not.toHaveBeenCalled();
  });

  it('dispatches read messages to AckService.handleReadStatus', async () => {
    const upstream = makeUpstream('read', {
      lastReadMsgId: 'msg-last-read',
    });

    await expect(
      consumer.handleUpstreamMessage(upstream as any),
    ).resolves.toBeUndefined();

    expect(ackService.handleReadStatus).toHaveBeenCalledWith(upstream);
    expect(messageService.processUpstreamMessage).not.toHaveBeenCalled();
    expect(ackService.handleClientAck).not.toHaveBeenCalled();
  });

  it('logs typing messages without touching persistence services', async () => {
    const upstream = makeUpstream('typing', {
      isTyping: true,
    });

    await expect(
      consumer.handleUpstreamMessage(upstream as any),
    ).resolves.toBeUndefined();

    expect(messageService.processUpstreamMessage).not.toHaveBeenCalled();
    expect(ackService.handleClientAck).not.toHaveBeenCalled();
    expect(ackService.handleReadStatus).not.toHaveBeenCalled();
    expect((consumer as any).logger.debug).toHaveBeenCalledWith(
      'Typing indicator from user-1 in channel-1',
    );
  });

  it.each(['online', 'offline'] as const)(
    'handles presence %s events without persistence calls',
    async (event) => {
      const upstream = makeUpstream('presence', {
        event,
        timestamp: 1234567890,
      });

      await expect(
        consumer.handleUpstreamMessage(upstream as any),
      ).resolves.toBeUndefined();

      expect(messageService.processUpstreamMessage).not.toHaveBeenCalled();
      expect(ackService.handleClientAck).not.toHaveBeenCalled();
      expect(ackService.handleReadStatus).not.toHaveBeenCalled();
      if (event === 'online') {
        expect((consumer as any).logger.log).toHaveBeenCalledWith(
          'User user-1 came online on gateway gateway-1',
        );
      } else {
        expect((consumer as any).logger.debug).toHaveBeenCalledWith(
          'User user-1 went offline',
        );
      }
    },
  );

  it('warns on unknown message types and skips service calls', async () => {
    const upstream = makeUpstream('tracking');

    await expect(
      consumer.handleUpstreamMessage(upstream as any),
    ).resolves.toBeUndefined();

    expect((consumer as any).logger.warn).toHaveBeenCalledWith(
      'Unknown message type: tracking',
    );
    expect(messageService.processUpstreamMessage).not.toHaveBeenCalled();
    expect(ackService.handleClientAck).not.toHaveBeenCalled();
    expect(ackService.handleReadStatus).not.toHaveBeenCalled();
  });

  it('returns Nack(false) when post-broadcast processing fails', async () => {
    postBroadcastService = {
      processTask: jest.fn<any>().mockRejectedValueOnce(new Error('boom')),
    };
    consumer = new UpstreamConsumer(
      messageService as any,
      ackService as any,
      postBroadcastService as any,
    );
    (consumer as any).logger = {
      debug: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const result = await consumer.handlePostBroadcastTask({
      msgId: 'msg-1',
      channelId: 'channel-1',
      senderId: 'user-1',
      broadcastAt: 1234567890,
    });

    expect(result).toBeDefined();
    expect(result?.constructor?.name).toBe('Nack');
    expect((consumer as any).logger.error).toHaveBeenCalledWith(
      'Failed to process post-broadcast task: Error: boom',
    );
  });

  it('skips post-broadcast work when the service is unavailable', async () => {
    consumer = new UpstreamConsumer(messageService as any, ackService as any);
    (consumer as any).logger = {
      debug: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    await expect(
      consumer.handlePostBroadcastTask({
        msgId: 'msg-1',
        channelId: 'channel-1',
        senderId: 'user-1',
        broadcastAt: 1234567890,
      }),
    ).resolves.toBeUndefined();

    expect((consumer as any).logger.warn).toHaveBeenCalledWith(
      'PostBroadcastService not available, skipping task',
    );
    expect(messageService.processUpstreamMessage).not.toHaveBeenCalled();
    expect(ackService.handleClientAck).not.toHaveBeenCalled();
    expect(ackService.handleReadStatus).not.toHaveBeenCalled();
  });

  it('processes post-broadcast work when the service is available', async () => {
    const task = {
      msgId: 'msg-1',
      channelId: 'channel-1',
      senderId: 'user-1',
      broadcastAt: 1234567890,
    };

    await expect(
      consumer.handlePostBroadcastTask(task),
    ).resolves.toBeUndefined();

    expect(postBroadcastService?.processTask).toHaveBeenCalledWith(task);
    expect((consumer as any).logger.warn).not.toHaveBeenCalledWith(
      'PostBroadcastService not available, skipping task',
    );
  });
});
