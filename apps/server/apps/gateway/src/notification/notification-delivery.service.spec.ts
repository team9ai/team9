import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { REDIS_KEYS } from '../im/shared/constants/redis-keys.js';
import {
  NotificationDeliveryService,
  WS_NOTIFICATION_EVENTS,
} from './notification-delivery.service.js';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe('NotificationDeliveryService', () => {
  let service: NotificationDeliveryService;
  let redisService: {
    smembers: jest.Mock<any>;
  };
  let gateway: {
    sendToUser: jest.Mock<any>;
  };
  let warnSpy: jest.SpiedFunction<any>;
  let debugSpy: jest.SpiedFunction<any>;
  let logSpy: jest.SpiedFunction<any>;

  const notification = {
    id: 'notif-1',
    category: 'message',
    type: 'mention',
    title: 'New mention',
    body: 'You were mentioned',
  } as const;

  const counts = {
    total: 3,
    byCategory: {
      message: 1,
      system: 1,
      workspace: 1,
    },
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
  } as const;

  beforeEach(() => {
    redisService = {
      smembers: jest.fn<any>(),
    };
    gateway = {
      sendToUser: jest.fn<any>().mockResolvedValue(undefined),
    };
    service = new NotificationDeliveryService(redisService as any);
    warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
    debugSpy = jest
      .spyOn((service as any).logger, 'debug')
      .mockImplementation(() => undefined);
    logSpy = jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation(() => undefined);
    service.setWebsocketGateway(gateway as any);
  });

  it('warns and skips delivery when the websocket gateway is not set', async () => {
    (service as any).websocketGateway = null;

    await service.deliverToUser('user-1', notification as any);

    expect(redisService.smembers).not.toHaveBeenCalled();
    expect(gateway.sendToUser).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'WebSocket gateway not initialized, skipping delivery',
    );
  });

  it('checks Redis and sends new notifications to online users', async () => {
    redisService.smembers.mockResolvedValueOnce(['socket-1']);

    await service.deliverToUser('user-1', notification as any);

    expect(redisService.smembers).toHaveBeenCalledWith(
      REDIS_KEYS.USER_SOCKETS('user-1'),
    );
    expect(gateway.sendToUser).toHaveBeenCalledWith(
      'user-1',
      WS_NOTIFICATION_EVENTS.NEW,
      notification,
    );
    expect(debugSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('offline'),
    );
  });

  it('logs the offline branch without sending websocket events', async () => {
    redisService.smembers.mockResolvedValueOnce([]);

    await service.deliverToUser('user-2', notification as any);

    expect(redisService.smembers).toHaveBeenCalledWith(
      REDIS_KEYS.USER_SOCKETS('user-2'),
    );
    expect(gateway.sendToUser).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(
      'User user-2 is offline, notification persisted for later',
    );
  });

  it('delivers to users sequentially', async () => {
    const first = createDeferred<string[]>();
    const second = createDeferred<string[]>();

    redisService.smembers
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const delivery = service.deliverToUsers(
      ['user-1', 'user-2'],
      notification as any,
    );

    await Promise.resolve();

    expect(redisService.smembers).toHaveBeenCalledTimes(1);
    expect(gateway.sendToUser).not.toHaveBeenCalled();

    first.resolve(['socket-1']);
    await first.promise;

    second.resolve(['socket-2']);
    await delivery;

    expect(redisService.smembers).toHaveBeenCalledTimes(2);

    expect(gateway.sendToUser).toHaveBeenNthCalledWith(
      1,
      'user-1',
      WS_NOTIFICATION_EVENTS.NEW,
      notification,
    );
    expect(gateway.sendToUser).toHaveBeenNthCalledWith(
      2,
      'user-2',
      WS_NOTIFICATION_EVENTS.NEW,
      notification,
    );
  });

  it('broadcasts counts updates to online users', async () => {
    redisService.smembers.mockResolvedValueOnce(['socket-1']);

    await service.broadcastCountsUpdate('user-3', counts as any);

    expect(redisService.smembers).toHaveBeenCalledWith(
      REDIS_KEYS.USER_SOCKETS('user-3'),
    );
    expect(gateway.sendToUser).toHaveBeenCalledWith(
      'user-3',
      WS_NOTIFICATION_EVENTS.COUNTS_UPDATED,
      counts,
    );
    expect(debugSpy).toHaveBeenCalledWith('Sent counts update to user user-3');
  });

  it('broadcasts notification read events to online users', async () => {
    redisService.smembers.mockResolvedValueOnce(['socket-1']);

    await service.broadcastNotificationRead('user-4', ['notif-1', 'notif-2']);

    expect(redisService.smembers).toHaveBeenCalledWith(
      REDIS_KEYS.USER_SOCKETS('user-4'),
    );
    expect(gateway.sendToUser).toHaveBeenCalledWith(
      'user-4',
      WS_NOTIFICATION_EVENTS.READ,
      { notificationIds: ['notif-1', 'notif-2'] },
    );
    expect(debugSpy).toHaveBeenCalledWith(
      'Sent notification read event to user user-4',
    );
  });

  it('logs when the websocket gateway is set', () => {
    expect(logSpy).toHaveBeenCalledWith(
      'WebSocket gateway set for notification delivery',
    );
  });
});
