import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { MQ_EXCHANGES, MQ_ROUTING_KEYS } from '@team9/shared';
import { MessageRouterService } from './message-router.service.js';

type MockFn = jest.Mock<(...args: any[]) => any>;

describe('MessageRouterService', () => {
  let service: MessageRouterService;
  let amqpConnection: { publish: MockFn };
  let redisService: { getClient: MockFn; exists: MockFn };
  let pipeline: { hget: MockFn; exec: MockFn };
  let message: any;

  beforeEach(() => {
    pipeline = {
      hget: jest.fn<any>().mockReturnThis(),
      exec: jest.fn<any>().mockResolvedValue([]),
    };

    amqpConnection = {
      publish: jest.fn<any>().mockResolvedValue(undefined),
    };

    redisService = {
      getClient: jest.fn<any>().mockReturnValue({
        pipeline: jest.fn<any>().mockReturnValue(pipeline),
      }),
      exists: jest.fn<any>().mockResolvedValue(1),
    };

    service = new MessageRouterService(
      amqpConnection as any,
      redisService as any,
    );

    message = {
      msgId: 'msg-1',
      seqId: BigInt(9),
      tenantId: 'tenant-1',
      channelId: 'channel-1',
      type: 'message.created',
      payload: { text: 'hello' },
    };
  });

  it('routes online users by gateway and returns offline users separately', async () => {
    pipeline.exec.mockResolvedValue([
      [null, 'gateway-a'],
      [null, 'gateway-b'],
      [null, 'gateway-a'],
      [null, null],
    ]);

    const result = await service.routeMessage(message, [
      'user-1',
      'user-2',
      'user-3',
      'user-4',
    ]);

    expect(pipeline.hget).toHaveBeenCalledTimes(4);
    expect(amqpConnection.publish).toHaveBeenCalledTimes(2);
    expect(amqpConnection.publish).toHaveBeenNthCalledWith(
      1,
      MQ_EXCHANGES.IM_TOPIC,
      MQ_ROUTING_KEYS.TO_GATEWAY('gateway-a'),
      expect.objectContaining({
        seqId: '9',
        targetUserIds: ['user-1', 'user-3'],
        targetGatewayIds: ['gateway-a'],
      }),
      expect.objectContaining({
        persistent: true,
        timestamp: expect.any(Number),
      }),
    );
    expect(amqpConnection.publish).toHaveBeenNthCalledWith(
      2,
      MQ_EXCHANGES.IM_TOPIC,
      MQ_ROUTING_KEYS.TO_GATEWAY('gateway-b'),
      expect.objectContaining({
        seqId: '9',
        targetUserIds: ['user-2'],
        targetGatewayIds: ['gateway-b'],
      }),
      expect.objectContaining({
        persistent: true,
        timestamp: expect.any(Number),
      }),
    );
    expect(result).toEqual({
      online: ['user-1', 'user-2', 'user-3'],
      offline: ['user-4'],
    });
  });

  it('does not publish when every target user is offline', async () => {
    pipeline.exec.mockResolvedValue([
      [null, null],
      [null, null],
    ]);

    const result = await service.routeMessage(message, ['user-1', 'user-2']);

    expect(amqpConnection.publish).not.toHaveBeenCalled();
    expect(result).toEqual({
      online: [],
      offline: ['user-1', 'user-2'],
    });
  });

  it('publishes a direct gateway delivery with a stringified seqId', async () => {
    await service.sendToGateway('gateway-1', message, ['user-1']);

    expect(amqpConnection.publish).toHaveBeenCalledWith(
      MQ_EXCHANGES.IM_TOPIC,
      MQ_ROUTING_KEYS.TO_GATEWAY('gateway-1'),
      expect.objectContaining({
        seqId: '9',
        targetUserIds: ['user-1'],
        targetGatewayIds: ['gateway-1'],
      }),
      expect.objectContaining({
        persistent: true,
        timestamp: expect.any(Number),
      }),
    );
  });

  it('broadcasts to all gateways with an empty routing key', async () => {
    await service.broadcastToAllGateways(message, ['user-1', 'user-2']);

    expect(amqpConnection.publish).toHaveBeenCalledWith(
      MQ_EXCHANGES.IM_BROADCAST,
      '',
      expect.objectContaining({
        seqId: '9',
        targetUserIds: ['user-1', 'user-2'],
        targetGatewayIds: [],
      }),
      expect.objectContaining({
        persistent: true,
        timestamp: expect.any(Number),
      }),
    );
  });

  it('reads online state from redis existence checks', async () => {
    redisService.exists.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(service.isUserOnline('user-1')).resolves.toBe(true);
    await expect(service.isUserOnline('user-2')).resolves.toBe(false);
    expect(redisService.exists).toHaveBeenNthCalledWith(
      1,
      'im:route:user:user-1',
    );
    expect(redisService.exists).toHaveBeenNthCalledWith(
      2,
      'im:route:user:user-2',
    );
  });
});
