import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';

// ── Mock web-push library ───────────────────────────────────────────
const mockSetVapidDetails = jest.fn();
const mockSendNotification = jest.fn<any>();

jest.unstable_mockModule('web-push', () => ({
  default: {
    setVapidDetails: mockSetVapidDetails,
    sendNotification: mockSendNotification,
  },
  setVapidDetails: mockSetVapidDetails,
  sendNotification: mockSendNotification,
}));

// Must import after mock registration (ESM mock requirement)
const { WebPushService } = await import('./web-push.service.js');

// ── Helpers ─────────────────────────────────────────────────────────

function createSubscription(
  overrides?: Partial<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>,
) {
  return {
    id: 'sub-1',
    userId: 'user-1',
    endpoint: 'https://push.example.com/sub/abc',
    p256dh: 'test-p256dh-key',
    auth: 'test-auth-key',
    userAgent: 'Test/1.0',
    createdAt: new Date('2026-01-01'),
    lastUsedAt: null,
    ...overrides,
  };
}

const NOTIFICATION = {
  id: 'notif-1',
  title: 'New mention',
  body: 'You were mentioned in #general',
  type: 'mention',
  category: 'message',
  actionUrl: '/channels/general',
  actor: {
    id: 'actor-1',
    username: 'alice',
    displayName: 'Alice',
    avatarUrl: 'https://example.com/avatar.png',
  },
};

describe('WebPushService', () => {
  let service: InstanceType<typeof WebPushService>;
  let pushSubscriptionService: {
    getSubscriptions: jest.Mock<any>;
    updateLastUsed: jest.Mock<any>;
    removeSubscription: jest.Mock<any>;
  };
  let logSpy: jest.SpiedFunction<any>;
  let warnSpy: jest.SpiedFunction<any>;

  // Save original env so we can restore after each test
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    jest.clearAllMocks();

    // Save VAPID env vars
    savedEnv.VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
    savedEnv.VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
    savedEnv.VAPID_SUBJECT = process.env.VAPID_SUBJECT;

    // Clear VAPID env vars by default
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;

    pushSubscriptionService = {
      getSubscriptions: jest.fn<any>().mockResolvedValue([]),
      updateLastUsed: jest.fn<any>().mockResolvedValue(undefined),
      removeSubscription: jest.fn<any>().mockResolvedValue(undefined),
    };

    service = new WebPushService(pushSubscriptionService as any);

    logSpy = jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    // Restore env vars
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  // ── onModuleInit / isEnabled ──────────────────────────────────────

  describe('onModuleInit', () => {
    it('should set VAPID details and enable when both keys are configured', () => {
      process.env.VAPID_PUBLIC_KEY = 'test-public-key';
      process.env.VAPID_PRIVATE_KEY = 'test-private-key';
      process.env.VAPID_SUBJECT = 'mailto:test@example.com';

      service.onModuleInit();

      expect(service.isEnabled()).toBe(true);
      expect(mockSetVapidDetails).toHaveBeenCalledWith(
        'mailto:test@example.com',
        'test-public-key',
        'test-private-key',
      );
      expect(logSpy).toHaveBeenCalledWith(
        'Web Push configured with VAPID keys',
      );
    });

    it('should use default VAPID subject when not explicitly set', () => {
      process.env.VAPID_PUBLIC_KEY = 'pub-key';
      process.env.VAPID_PRIVATE_KEY = 'priv-key';

      service.onModuleInit();

      expect(service.isEnabled()).toBe(true);
      // Default from env.ts: 'mailto:noreply@team9.ai'
      expect(mockSetVapidDetails).toHaveBeenCalledWith(
        'mailto:noreply@team9.ai',
        'pub-key',
        'priv-key',
      );
    });

    it('should disable when no VAPID keys are configured', () => {
      service.onModuleInit();

      expect(service.isEnabled()).toBe(false);
      expect(mockSetVapidDetails).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        'Web Push disabled: VAPID_PUBLIC_KEY and/or VAPID_PRIVATE_KEY not configured',
      );
    });

    it('should disable when only public key is set', () => {
      process.env.VAPID_PUBLIC_KEY = 'test-public-key';

      service.onModuleInit();

      expect(service.isEnabled()).toBe(false);
      expect(mockSetVapidDetails).not.toHaveBeenCalled();
    });

    it('should disable when only private key is set', () => {
      process.env.VAPID_PRIVATE_KEY = 'test-private-key';

      service.onModuleInit();

      expect(service.isEnabled()).toBe(false);
      expect(mockSetVapidDetails).not.toHaveBeenCalled();
    });
  });

  describe('isEnabled', () => {
    it('should return false before onModuleInit is called', () => {
      expect(service.isEnabled()).toBe(false);
    });
  });

  // ── sendPush ──────────────────────────────────────────────────────

  describe('sendPush', () => {
    function enableVapid() {
      process.env.VAPID_PUBLIC_KEY = 'pub';
      process.env.VAPID_PRIVATE_KEY = 'priv';
      process.env.VAPID_SUBJECT = 'mailto:t@t.com';
      service.onModuleInit();
    }

    it('should return early when not enabled', async () => {
      // Don't call enableVapid — disabled by default
      await service.sendPush('user-1', NOTIFICATION as any);

      expect(pushSubscriptionService.getSubscriptions).not.toHaveBeenCalled();
      expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it('should return when user has no subscriptions', async () => {
      enableVapid();
      pushSubscriptionService.getSubscriptions.mockResolvedValue([]);

      await service.sendPush('user-1', NOTIFICATION as any);

      expect(pushSubscriptionService.getSubscriptions).toHaveBeenCalledWith(
        'user-1',
      );
      expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it('should send notification to a single subscription and update lastUsed', async () => {
      enableVapid();
      const sub = createSubscription();
      pushSubscriptionService.getSubscriptions.mockResolvedValue([sub]);
      mockSendNotification.mockResolvedValue({});

      await service.sendPush('user-1', NOTIFICATION as any);

      expect(mockSendNotification).toHaveBeenCalledWith(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify({
          id: NOTIFICATION.id,
          title: NOTIFICATION.title,
          body: NOTIFICATION.body,
          type: NOTIFICATION.type,
          category: NOTIFICATION.category,
          actionUrl: NOTIFICATION.actionUrl,
          actor: { avatarUrl: NOTIFICATION.actor.avatarUrl },
        }),
      );
      expect(pushSubscriptionService.updateLastUsed).toHaveBeenCalledWith(
        'sub-1',
      );
    });

    it('should send to multiple subscriptions concurrently', async () => {
      enableVapid();
      const sub1 = createSubscription({
        id: 'sub-1',
        endpoint: 'https://push.example.com/1',
      });
      const sub2 = createSubscription({
        id: 'sub-2',
        endpoint: 'https://push.example.com/2',
      });
      const sub3 = createSubscription({
        id: 'sub-3',
        endpoint: 'https://push.example.com/3',
      });
      pushSubscriptionService.getSubscriptions.mockResolvedValue([
        sub1,
        sub2,
        sub3,
      ]);
      mockSendNotification.mockResolvedValue({});

      await service.sendPush('user-1', NOTIFICATION as any);

      expect(mockSendNotification).toHaveBeenCalledTimes(3);
      expect(pushSubscriptionService.updateLastUsed).toHaveBeenCalledTimes(3);
      expect(pushSubscriptionService.updateLastUsed).toHaveBeenCalledWith(
        'sub-1',
      );
      expect(pushSubscriptionService.updateLastUsed).toHaveBeenCalledWith(
        'sub-2',
      );
      expect(pushSubscriptionService.updateLastUsed).toHaveBeenCalledWith(
        'sub-3',
      );
    });

    it('should remove subscription on 410 Gone error', async () => {
      enableVapid();
      const sub = createSubscription();
      pushSubscriptionService.getSubscriptions.mockResolvedValue([sub]);
      mockSendNotification.mockRejectedValue({ statusCode: 410 });

      await service.sendPush('user-1', NOTIFICATION as any);

      expect(pushSubscriptionService.removeSubscription).toHaveBeenCalledWith(
        'sub-1',
      );
      expect(pushSubscriptionService.updateLastUsed).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        'Push endpoint expired/invalid for subscription sub-1, removing',
      );
    });

    it('should remove subscription on 404 Not Found error', async () => {
      enableVapid();
      const sub = createSubscription();
      pushSubscriptionService.getSubscriptions.mockResolvedValue([sub]);
      mockSendNotification.mockRejectedValue({ statusCode: 404 });

      await service.sendPush('user-1', NOTIFICATION as any);

      expect(pushSubscriptionService.removeSubscription).toHaveBeenCalledWith(
        'sub-1',
      );
      expect(pushSubscriptionService.updateLastUsed).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        'Push endpoint expired/invalid for subscription sub-1, removing',
      );
    });

    it('should log warning on other errors without throwing', async () => {
      enableVapid();
      const sub = createSubscription();
      pushSubscriptionService.getSubscriptions.mockResolvedValue([sub]);
      const error = new Error('Network timeout');
      (error as any).statusCode = 500;
      mockSendNotification.mockRejectedValue(error);

      // Should not throw
      await service.sendPush('user-1', NOTIFICATION as any);

      expect(pushSubscriptionService.removeSubscription).not.toHaveBeenCalled();
      expect(pushSubscriptionService.updateLastUsed).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to send push to subscription sub-1: Network timeout',
      );
    });

    it('should handle errors without statusCode gracefully', async () => {
      enableVapid();
      const sub = createSubscription();
      pushSubscriptionService.getSubscriptions.mockResolvedValue([sub]);
      mockSendNotification.mockRejectedValue(new Error('Unknown error'));

      await service.sendPush('user-1', NOTIFICATION as any);

      expect(pushSubscriptionService.removeSubscription).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to send push to subscription sub-1: Unknown error',
      );
    });

    it('should handle non-Error thrown values', async () => {
      enableVapid();
      const sub = createSubscription();
      pushSubscriptionService.getSubscriptions.mockResolvedValue([sub]);
      mockSendNotification.mockRejectedValue('some string error');

      await service.sendPush('user-1', NOTIFICATION as any);

      expect(pushSubscriptionService.removeSubscription).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to send push to subscription sub-1: some string error',
      );
    });

    it('should handle mixed success and failure across subscriptions', async () => {
      enableVapid();
      const sub1 = createSubscription({
        id: 'sub-1',
        endpoint: 'https://push.example.com/1',
      });
      const sub2 = createSubscription({
        id: 'sub-2',
        endpoint: 'https://push.example.com/2',
      });
      const sub3 = createSubscription({
        id: 'sub-3',
        endpoint: 'https://push.example.com/3',
      });
      pushSubscriptionService.getSubscriptions.mockResolvedValue([
        sub1,
        sub2,
        sub3,
      ]);

      mockSendNotification
        .mockResolvedValueOnce({}) // sub-1: success
        .mockRejectedValueOnce({ statusCode: 410 }) // sub-2: stale
        .mockResolvedValueOnce({}); // sub-3: success

      await service.sendPush('user-1', NOTIFICATION as any);

      // sub-1: success -> updateLastUsed
      expect(pushSubscriptionService.updateLastUsed).toHaveBeenCalledWith(
        'sub-1',
      );
      // sub-2: 410 -> removeSubscription
      expect(pushSubscriptionService.removeSubscription).toHaveBeenCalledWith(
        'sub-2',
      );
      // sub-3: success -> updateLastUsed
      expect(pushSubscriptionService.updateLastUsed).toHaveBeenCalledWith(
        'sub-3',
      );
    });

    it('should handle notification without actor', async () => {
      enableVapid();
      const sub = createSubscription();
      pushSubscriptionService.getSubscriptions.mockResolvedValue([sub]);
      mockSendNotification.mockResolvedValue({});

      await service.sendPush('user-1', {
        ...NOTIFICATION,
        actor: null,
      } as any);

      const payload = JSON.parse(mockSendNotification.mock.calls[0][1]);
      expect(payload.actor).toBeNull();
    });

    it('should handle notification with undefined actor', async () => {
      enableVapid();
      const sub = createSubscription();
      pushSubscriptionService.getSubscriptions.mockResolvedValue([sub]);
      mockSendNotification.mockResolvedValue({});

      const { actor: _, ...noActor } = NOTIFICATION;
      await service.sendPush('user-1', noActor as any);

      const payload = JSON.parse(mockSendNotification.mock.calls[0][1]);
      expect(payload.actor).toBeNull();
    });

    it('should handle notification without optional fields', async () => {
      enableVapid();
      const sub = createSubscription();
      pushSubscriptionService.getSubscriptions.mockResolvedValue([sub]);
      mockSendNotification.mockResolvedValue({});

      const minimalNotification = {
        title: 'Test',
        type: 'mention',
        category: 'message',
      };

      await service.sendPush('user-1', minimalNotification as any);

      const payload = JSON.parse(mockSendNotification.mock.calls[0][1]);
      expect(payload.title).toBe('Test');
      expect(payload.id).toBeUndefined();
      expect(payload.body).toBeUndefined();
      expect(payload.actionUrl).toBeUndefined();
      expect(payload.actor).toBeNull();
    });
  });
});
