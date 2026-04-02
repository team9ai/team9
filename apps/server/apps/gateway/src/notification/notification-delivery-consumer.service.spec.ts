import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockRabbitSubscribe = jest.fn(() => () => undefined);

class MockNack {
  constructor(public readonly requeue: boolean) {}
}

jest.unstable_mockModule('@team9/rabbitmq', () => ({
  RabbitSubscribe: mockRabbitSubscribe,
  Nack: MockNack,
  RABBITMQ_QUEUES: {
    NOTIFICATION_DELIVERY: 'notification.delivery',
  },
  RABBITMQ_EXCHANGES: {
    NOTIFICATION_DELIVERY: 'notification.delivery.exchange',
  },
}));

jest.unstable_mockModule('@team9/redis', () => ({
  RedisService: class RedisService {},
}));

jest.unstable_mockModule('@team9/shared', () => ({
  env: {},
  MQ_EXCHANGES: {
    IM_DLX: 'im.dlx',
  },
}));

const { NotificationDeliveryConsumerService } =
  await import('./notification-delivery-consumer.service.js');
const { Nack } = await import('@team9/rabbitmq');

describe('NotificationDeliveryConsumerService', () => {
  let deliveryService: {
    deliverToUser: jest.Mock<any>;
    broadcastCountsUpdate: jest.Mock<any>;
    broadcastNotificationRead: jest.Mock<any>;
  };
  let service: NotificationDeliveryConsumerService;
  let logSpy: jest.SpiedFunction<any>;
  let debugSpy: jest.SpiedFunction<any>;
  let warnSpy: jest.SpiedFunction<any>;
  let errorSpy: jest.SpiedFunction<any>;

  beforeEach(() => {
    deliveryService = {
      deliverToUser: jest.fn<any>().mockResolvedValue(undefined),
      broadcastCountsUpdate: jest.fn<any>().mockResolvedValue(undefined),
      broadcastNotificationRead: jest.fn<any>().mockResolvedValue(undefined),
    };
    service = new NotificationDeliveryConsumerService(deliveryService as any);
    logSpy = jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation(() => undefined);
    debugSpy = jest
      .spyOn((service as any).logger, 'debug')
      .mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);
  });

  it('logs initialization during module init', () => {
    service.onModuleInit();

    expect(logSpy).toHaveBeenCalledWith(
      'NotificationDeliveryConsumerService initialized in Gateway',
    );
  });

  it.each([
    {
      task: {
        type: 'new',
        userId: 'user-1',
        payload: {
          id: 'notif-1',
          category: 'message',
          type: 'mention',
          title: 'New mention',
        },
      },
      method: 'deliverToUser' as const,
      expectedArgs: ['user-1', expect.any(Object)],
    },
    {
      task: {
        type: 'counts',
        userId: 'user-2',
        payload: {
          total: 2,
          byCategory: { message: 1, system: 1, workspace: 0 },
          byType: {
            mention: 1,
            channel_mention: 0,
            everyone_mention: 0,
            here_mention: 0,
            reply: 0,
            thread_reply: 0,
            dm_received: 0,
            system_announcement: 0,
            maintenance_notice: 0,
            version_update: 0,
            workspace_invitation: 0,
            role_changed: 0,
            member_joined: 0,
            member_left: 0,
            channel_invite: 0,
          },
        },
      },
      method: 'broadcastCountsUpdate' as const,
      expectedArgs: [
        'user-2',
        expect.objectContaining({
          total: 2,
        }),
      ],
    },
    {
      task: {
        type: 'read',
        userId: 'user-3',
        payload: {
          notificationIds: ['notif-1', 'notif-2'],
        },
      },
      method: 'broadcastNotificationRead' as const,
      expectedArgs: ['user-3', ['notif-1', 'notif-2']],
    },
  ])(
    'dispatches $task.type delivery tasks to the matching service method',
    async ({ task, method, expectedArgs }) => {
      await service.handleDeliveryTask(task as any);

      expect(deliveryService[method]).toHaveBeenCalledWith(...expectedArgs);
      expect(deliveryService.deliverToUser).toHaveBeenCalledTimes(
        method === 'deliverToUser' ? 1 : 0,
      );
      expect(deliveryService.broadcastCountsUpdate).toHaveBeenCalledTimes(
        method === 'broadcastCountsUpdate' ? 1 : 0,
      );
      expect(deliveryService.broadcastNotificationRead).toHaveBeenCalledTimes(
        method === 'broadcastNotificationRead' ? 1 : 0,
      );
      expect(debugSpy).toHaveBeenCalledWith(
        `Received delivery task: ${task.type} for user: ${task.userId}`,
      );
    },
  );

  it('warns on unknown task types without calling the delivery service', async () => {
    await service.handleDeliveryTask({
      type: 'bogus',
      userId: 'user-4',
      payload: {},
    } as any);

    expect(warnSpy).toHaveBeenCalledWith('Unknown delivery task type: bogus');
    expect(deliveryService.deliverToUser).not.toHaveBeenCalled();
    expect(deliveryService.broadcastCountsUpdate).not.toHaveBeenCalled();
    expect(deliveryService.broadcastNotificationRead).not.toHaveBeenCalled();
  });

  it('returns a nack without requeue when the delivery service throws', async () => {
    deliveryService.deliverToUser.mockRejectedValueOnce(new Error('boom'));

    const result = await service.handleDeliveryTask({
      type: 'new',
      userId: 'user-5',
      payload: { id: 'notif-5', category: 'message', type: 'mention' },
    } as any);

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to process delivery task: Error: boom',
    );
    expect(result).toBeInstanceOf(Nack);
    expect(result).toEqual(new Nack(false));
  });
});
