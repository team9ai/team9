import { beforeEach, describe, expect, it, jest } from '@jest/globals';

class MockNack {
  constructor(public readonly requeue: boolean) {}
}

jest.unstable_mockModule('@team9/rabbitmq', () => ({
  RabbitSubscribe: () => () => undefined,
  Nack: MockNack,
  RABBITMQ_QUEUES: {
    NOTIFICATION_TASKS: 'notification.tasks',
  },
  RABBITMQ_EXCHANGES: {
    NOTIFICATION_EVENTS: 'notification.events',
  },
}));

jest.unstable_mockModule('@team9/shared', () => ({
  MQ_EXCHANGES: {
    IM_DLX: 'im.dlx',
  },
  env: {},
}));

jest.unstable_mockModule('./notification-trigger.service.js', () => ({
  NotificationTriggerService: class NotificationTriggerService {},
}));

const { NotificationConsumerService } =
  await import('./notification-consumer.service.js');

function createTriggerServiceMock() {
  return {
    triggerMentionNotifications: jest.fn<any>().mockResolvedValue(undefined),
    triggerReplyNotification: jest.fn<any>().mockResolvedValue(undefined),
    triggerDMNotification: jest.fn<any>().mockResolvedValue(undefined),
    triggerWorkspaceInvitation: jest.fn<any>().mockResolvedValue(undefined),
    triggerMemberJoined: jest.fn<any>().mockResolvedValue(undefined),
    triggerRoleChanged: jest.fn<any>().mockResolvedValue(undefined),
  };
}

describe('NotificationConsumerService', () => {
  let service: NotificationConsumerService;
  let triggerService: ReturnType<typeof createTriggerServiceMock>;

  beforeEach(() => {
    jest.clearAllMocks();
    triggerService = createTriggerServiceMock();
    service = new NotificationConsumerService(triggerService as any);
  });

  it('logs module initialization', () => {
    const logSpy = jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation(() => undefined);

    service.onModuleInit();

    expect(logSpy).toHaveBeenCalledWith(
      'NotificationConsumerService initialized in im-worker',
    );
  });

  it('dispatches supported task types to the matching trigger handlers', async () => {
    await service.handleNotificationTask({
      type: 'mention',
      payload: { id: 'mention-1' },
    } as any);
    await service.handleNotificationTask({
      type: 'reply',
      payload: { id: 'reply-1' },
    } as any);
    await service.handleNotificationTask({
      type: 'dm',
      payload: { id: 'dm-1' },
    } as any);
    await service.handleNotificationTask({
      type: 'workspace_invitation',
      payload: { id: 'invite-1' },
    } as any);
    await service.handleNotificationTask({
      type: 'member_joined',
      payload: { id: 'member-1' },
    } as any);
    await service.handleNotificationTask({
      type: 'role_changed',
      payload: { id: 'role-1' },
    } as any);

    expect(triggerService.triggerMentionNotifications).toHaveBeenCalledWith({
      id: 'mention-1',
    });
    expect(triggerService.triggerReplyNotification).toHaveBeenCalledWith({
      id: 'reply-1',
    });
    expect(triggerService.triggerDMNotification).toHaveBeenCalledWith({
      id: 'dm-1',
    });
    expect(triggerService.triggerWorkspaceInvitation).toHaveBeenCalledWith({
      id: 'invite-1',
    });
    expect(triggerService.triggerMemberJoined).toHaveBeenCalledWith({
      id: 'member-1',
    });
    expect(triggerService.triggerRoleChanged).toHaveBeenCalledWith({
      id: 'role-1',
    });
  });

  it('warns on unknown task types without throwing', async () => {
    const warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);

    await expect(
      service.handleNotificationTask({
        type: 'mystery',
        payload: {},
      } as any),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      'Unknown notification task type: mystery',
    );
  });

  it('returns a nack without requeueing when a handler throws', async () => {
    const errorSpy = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);
    triggerService.triggerMentionNotifications.mockRejectedValueOnce(
      new Error('worker down'),
    );

    const result = await service.handleNotificationTask({
      type: 'mention',
      payload: { id: 'mention-2' },
    } as any);

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to process notification task: Error: worker down',
    );
    expect(result).toBeInstanceOf(MockNack);
    expect((result as MockNack).requeue).toBe(false);
  });
});
