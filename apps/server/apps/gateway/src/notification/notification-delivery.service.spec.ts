import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { REDIS_KEYS } from '../im/shared/constants/redis-keys.js';
import {
  NotificationDeliveryService,
  WS_NOTIFICATION_EVENTS,
} from './notification-delivery.service.js';

describe('NotificationDeliveryService', () => {
  let service: NotificationDeliveryService;
  let redisService: {
    smembers: jest.Mock<any>;
  };
  let gateway: {
    sendToUser: jest.Mock<any>;
  };
  let webPushService: {
    isEnabled: jest.Mock<any>;
    sendPush: jest.Mock<any>;
  };
  let expoPushService: {
    isEnabled: jest.Mock<any>;
    sendPush: jest.Mock<any>;
  };
  let preferencesService: {
    shouldNotify: jest.Mock<any>;
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

  const defaultPrefs = {
    mentionsEnabled: true,
    repliesEnabled: true,
    dmsEnabled: true,
    systemEnabled: true,
    workspaceEnabled: true,
    desktopEnabled: true,
    soundEnabled: true,
    dndEnabled: false,
    dndStart: null,
    dndEnd: null,
    settings: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    redisService = {
      smembers: jest.fn<any>(),
    };
    gateway = {
      sendToUser: jest.fn<any>().mockResolvedValue(undefined),
    };
    webPushService = {
      isEnabled: jest.fn<any>().mockReturnValue(false),
      sendPush: jest.fn<any>().mockResolvedValue(undefined),
    };
    expoPushService = {
      isEnabled: jest.fn<any>().mockReturnValue(false),
      sendPush: jest.fn<any>().mockResolvedValue(undefined),
    };
    preferencesService = {
      shouldNotify: jest
        .fn<any>()
        .mockResolvedValue({ allowed: true, preferences: defaultPrefs }),
    };
    service = new NotificationDeliveryService(
      redisService as any,
      webPushService as any,
      preferencesService as any,
    );
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

  // ── WebSocket delivery ────────────────────────────────────────────

  describe('WebSocket delivery', () => {
    it('warns when the websocket gateway is not set but still attempts push', async () => {
      (service as any).websocketGateway = null;
      webPushService.isEnabled.mockReturnValue(true);

      await service.deliverToUser('user-1', notification as any);

      expect(redisService.smembers).not.toHaveBeenCalled();
      expect(gateway.sendToUser).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        'WebSocket gateway not initialized, skipping WS delivery',
      );
      // Web Push should still be attempted
      expect(preferencesService.shouldNotify).toHaveBeenCalled();
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

    it('always sends WebSocket regardless of notification preferences', async () => {
      redisService.smembers.mockResolvedValueOnce(['socket-1']);
      webPushService.isEnabled.mockReturnValue(true);
      preferencesService.shouldNotify.mockResolvedValue({
        allowed: false,
        preferences: defaultPrefs,
      });

      await service.deliverToUser('user-1', notification as any);

      // WebSocket should still be sent
      expect(gateway.sendToUser).toHaveBeenCalledWith(
        'user-1',
        WS_NOTIFICATION_EVENTS.NEW,
        notification,
      );
      // But Web Push should NOT be sent (allowed returned false)
      expect(webPushService.sendPush).not.toHaveBeenCalled();
    });
  });

  // ── Web Push delivery ─────────────────────────────────────────────

  describe('Web Push delivery', () => {
    it('should skip Web Push when VAPID is not configured', async () => {
      redisService.smembers.mockResolvedValueOnce(['socket-1']);
      webPushService.isEnabled.mockReturnValue(false);

      await service.deliverToUser('user-1', notification as any);

      expect(preferencesService.shouldNotify).not.toHaveBeenCalled();
      expect(webPushService.sendPush).not.toHaveBeenCalled();
    });

    it('should send Web Push when VAPID configured and preferences allow', async () => {
      redisService.smembers.mockResolvedValueOnce(['socket-1']);
      webPushService.isEnabled.mockReturnValue(true);
      preferencesService.shouldNotify.mockResolvedValue({
        allowed: true,
        preferences: { ...defaultPrefs, desktopEnabled: true },
      });

      await service.deliverToUser('user-1', notification as any);

      expect(preferencesService.shouldNotify).toHaveBeenCalledWith(
        'user-1',
        'mention',
        'message',
      );
      expect(webPushService.sendPush).toHaveBeenCalledWith(
        'user-1',
        notification,
      );
    });

    it('should skip Web Push when shouldNotify returns false', async () => {
      redisService.smembers.mockResolvedValueOnce(['socket-1']);
      webPushService.isEnabled.mockReturnValue(true);
      preferencesService.shouldNotify.mockResolvedValue({
        allowed: false,
        preferences: defaultPrefs,
      });

      await service.deliverToUser('user-1', notification as any);

      expect(preferencesService.shouldNotify).toHaveBeenCalled();
      expect(webPushService.sendPush).not.toHaveBeenCalled();
    });

    it('should skip Web Push when desktopEnabled is false', async () => {
      redisService.smembers.mockResolvedValueOnce(['socket-1']);
      webPushService.isEnabled.mockReturnValue(true);
      preferencesService.shouldNotify.mockResolvedValue({
        allowed: true,
        preferences: { ...defaultPrefs, desktopEnabled: false },
      });

      await service.deliverToUser('user-1', notification as any);

      expect(preferencesService.shouldNotify).toHaveBeenCalled();
      expect(webPushService.sendPush).not.toHaveBeenCalled();
    });

    it('should send Web Push even when user is offline (for mobile/browser push)', async () => {
      redisService.smembers.mockResolvedValueOnce([]); // offline
      webPushService.isEnabled.mockReturnValue(true);
      preferencesService.shouldNotify.mockResolvedValue({
        allowed: true,
        preferences: defaultPrefs,
      });

      await service.deliverToUser('user-1', notification as any);

      // WebSocket not sent (offline)
      expect(gateway.sendToUser).not.toHaveBeenCalled();
      // But Web Push IS sent
      expect(webPushService.sendPush).toHaveBeenCalledWith(
        'user-1',
        notification,
      );
    });

    it('should catch and log errors from shouldNotify without breaking WS delivery', async () => {
      redisService.smembers.mockResolvedValueOnce(['socket-1']);
      webPushService.isEnabled.mockReturnValue(true);
      preferencesService.shouldNotify.mockRejectedValue(
        new Error('DB connection lost'),
      );

      await service.deliverToUser('user-1', notification as any);

      // WebSocket delivery should still have happened
      expect(gateway.sendToUser).toHaveBeenCalledWith(
        'user-1',
        WS_NOTIFICATION_EVENTS.NEW,
        notification,
      );
      // Error should be logged
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Web push failed for user-1'),
      );
      // sendPush should NOT have been called
      expect(webPushService.sendPush).not.toHaveBeenCalled();
    });

    it('should catch errors from shouldNotify (e.g. DB timeout) without breaking WS delivery', async () => {
      redisService.smembers.mockResolvedValueOnce(['socket-1']);
      webPushService.isEnabled.mockReturnValue(true);
      preferencesService.shouldNotify.mockRejectedValue(
        new Error('DB timeout'),
      );

      await service.deliverToUser('user-1', notification as any);

      // WebSocket delivery should still have happened
      expect(gateway.sendToUser).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Web push failed for user-1'),
      );
      expect(webPushService.sendPush).not.toHaveBeenCalled();
    });

    it('should catch errors from sendPush without breaking', async () => {
      redisService.smembers.mockResolvedValueOnce(['socket-1']);
      webPushService.isEnabled.mockReturnValue(true);
      preferencesService.shouldNotify.mockResolvedValue({
        allowed: true,
        preferences: defaultPrefs,
      });
      webPushService.sendPush.mockRejectedValue(new Error('push failed'));

      await service.deliverToUser('user-1', notification as any);

      // WS should still have been sent
      expect(gateway.sendToUser).toHaveBeenCalledWith(
        'user-1',
        WS_NOTIFICATION_EVENTS.NEW,
        notification,
      );
      // Error logged
      expect(warnSpy).toHaveBeenCalledWith(
        'Web push failed for user-1: push failed',
      );
    });

    it('should log non-Error thrown values from sendPush directly', async () => {
      redisService.smembers.mockResolvedValueOnce(['socket-1']);
      webPushService.isEnabled.mockReturnValue(true);
      preferencesService.shouldNotify.mockResolvedValue({
        allowed: true,
        preferences: defaultPrefs,
      });
      webPushService.sendPush.mockRejectedValue('string error from push');

      await service.deliverToUser('user-1', notification as any);

      expect(gateway.sendToUser).toHaveBeenCalledWith(
        'user-1',
        WS_NOTIFICATION_EVENTS.NEW,
        notification,
      );
      expect(warnSpy).toHaveBeenCalledWith(
        'Web push failed for user-1: string error from push',
      );
    });

    it('should log non-Error thrown values from shouldNotify directly', async () => {
      redisService.smembers.mockResolvedValueOnce(['socket-1']);
      webPushService.isEnabled.mockReturnValue(true);
      preferencesService.shouldNotify.mockRejectedValue(42);

      await service.deliverToUser('user-1', notification as any);

      expect(gateway.sendToUser).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith('Web push failed for user-1: 42');
    });
  });

  // ── deliverToUsers ────────────────────────────────────────────────

  describe('deliverToUsers', () => {
    it('delivers to all users concurrently via Promise.allSettled', async () => {
      redisService.smembers
        .mockResolvedValueOnce(['socket-1'])
        .mockResolvedValueOnce(['socket-2']);

      await service.deliverToUsers(['user-1', 'user-2'], notification as any);

      expect(redisService.smembers).toHaveBeenCalledTimes(2);

      expect(gateway.sendToUser).toHaveBeenCalledWith(
        'user-1',
        WS_NOTIFICATION_EVENTS.NEW,
        notification,
      );
      expect(gateway.sendToUser).toHaveBeenCalledWith(
        'user-2',
        WS_NOTIFICATION_EVENTS.NEW,
        notification,
      );
    });

    it('does not reject even if one user delivery fails', async () => {
      redisService.smembers
        .mockRejectedValueOnce(new Error('redis down'))
        .mockResolvedValueOnce(['socket-2']);

      // Should not throw
      await service.deliverToUsers(['user-1', 'user-2'], notification as any);

      // user-2 should still have been delivered
      expect(gateway.sendToUser).toHaveBeenCalledWith(
        'user-2',
        WS_NOTIFICATION_EVENTS.NEW,
        notification,
      );
    });
  });

  // ── broadcastCountsUpdate ─────────────────────────────────────────

  describe('broadcastCountsUpdate', () => {
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
      expect(debugSpy).toHaveBeenCalledWith(
        'Sent counts update to user user-3',
      );
    });

    it('skips when gateway is not set', async () => {
      (service as any).websocketGateway = null;

      await service.broadcastCountsUpdate('user-3', counts as any);

      expect(redisService.smembers).not.toHaveBeenCalled();
    });

    it('skips sending when user is offline', async () => {
      redisService.smembers.mockResolvedValueOnce([]);

      await service.broadcastCountsUpdate('user-3', counts as any);

      expect(gateway.sendToUser).not.toHaveBeenCalled();
    });
  });

  // ── broadcastNotificationRead ─────────────────────────────────────

  describe('broadcastNotificationRead', () => {
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

    it('skips when gateway is not set', async () => {
      (service as any).websocketGateway = null;

      await service.broadcastNotificationRead('user-4', ['notif-1']);

      expect(redisService.smembers).not.toHaveBeenCalled();
    });

    it('skips sending when user is offline', async () => {
      redisService.smembers.mockResolvedValueOnce([]);

      await service.broadcastNotificationRead('user-4', ['notif-1', 'notif-2']);

      expect(redisService.smembers).toHaveBeenCalledWith(
        REDIS_KEYS.USER_SOCKETS('user-4'),
      );
      expect(gateway.sendToUser).not.toHaveBeenCalled();
      expect(debugSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Sent notification read event'),
      );
    });
  });

  // ── broadcastNotificationAllRead ──────────────────────────────────

  describe('broadcastNotificationAllRead', () => {
    it('broadcasts all-read events to online users', async () => {
      redisService.smembers.mockResolvedValueOnce(['socket-1']);

      await service.broadcastNotificationAllRead('user-5', 'message');

      expect(gateway.sendToUser).toHaveBeenCalledWith(
        'user-5',
        WS_NOTIFICATION_EVENTS.ALL_READ,
        expect.objectContaining({
          category: 'message',
          readAt: expect.any(String),
        }),
      );
    });

    it('skips when gateway is not set', async () => {
      (service as any).websocketGateway = null;

      await service.broadcastNotificationAllRead('user-5');

      expect(redisService.smembers).not.toHaveBeenCalled();
    });

    it('skips sending when user is offline', async () => {
      redisService.smembers.mockResolvedValueOnce([]);

      await service.broadcastNotificationAllRead('user-5');

      expect(gateway.sendToUser).not.toHaveBeenCalled();
    });
  });

  // ── setWebsocketGateway ───────────────────────────────────────────

  describe('setWebsocketGateway', () => {
    it('logs when the websocket gateway is set', () => {
      expect(logSpy).toHaveBeenCalledWith(
        'WebSocket gateway set for notification delivery',
      );
    });
  });
});
