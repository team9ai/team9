import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { DATABASE_CONNECTION } from '@team9/database';
import { ExpoPushService } from './push.service.js';
import type { ExpoPushTicket } from './push.service.js';

type MockFn = jest.Mock<(...args: any[]) => any>;

function mockDb() {
  const chain: Record<string, MockFn> = {};
  const methods = [
    'select',
    'from',
    'where',
    'insert',
    'values',
    'returning',
    'update',
    'set',
    'delete',
    'onConflictDoUpdate',
  ];

  for (const method of methods) {
    chain[method] = jest.fn<any>().mockReturnValue(chain);
  }

  chain.where.mockResolvedValue([]);
  chain.onConflictDoUpdate.mockResolvedValue([]);

  return chain;
}

const TOKEN_ROW = {
  id: 'token-uuid',
  userId: 'user-uuid',
  token: 'ExponentPushToken[abc123]',
  platform: 'ios' as const,
  createdAt: new Date('2026-04-01T00:00:00.000Z'),
  updatedAt: new Date('2026-04-01T00:00:00.000Z'),
};

const TOKEN_ROW_2 = {
  id: 'token-uuid-2',
  userId: 'user-uuid',
  token: 'ExponentPushToken[xyz789]',
  platform: 'android' as const,
  createdAt: new Date('2026-04-01T00:00:00.000Z'),
  updatedAt: new Date('2026-04-01T00:00:00.000Z'),
};

describe('ExpoPushService', () => {
  let service: ExpoPushService;
  let db: ReturnType<typeof mockDb>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    db = mockDb();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpoPushService,
        { provide: DATABASE_CONNECTION, useValue: db },
      ],
    }).compile();

    service = module.get<ExpoPushService>(ExpoPushService);

    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('isEnabled', () => {
    it('always returns true (Expo Push does not require VAPID keys)', () => {
      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('registerToken', () => {
    it('inserts a new push token with upsert', async () => {
      const result = await service.registerToken(
        'user-uuid',
        'ExponentPushToken[abc123]',
        'ios',
      );

      expect(result).toEqual({ message: 'Push token registered.' });
      expect(db.insert).toHaveBeenCalled();
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-uuid',
          token: 'ExponentPushToken[abc123]',
          platform: 'ios',
        }),
      );
      expect(db.onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          set: expect.objectContaining({ platform: 'ios' }),
        }),
      );
    });

    it('handles android platform', async () => {
      const result = await service.registerToken(
        'user-uuid',
        'ExponentPushToken[xyz789]',
        'android',
      );

      expect(result).toEqual({ message: 'Push token registered.' });
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'android' }),
      );
    });
  });

  describe('unregisterToken', () => {
    it('deletes the matching push token', async () => {
      const result = await service.unregisterToken(
        'user-uuid',
        'ExponentPushToken[abc123]',
      );

      expect(result).toEqual({ message: 'Push token removed.' });
      expect(db.delete).toHaveBeenCalled();
      expect(db.where).toHaveBeenCalled();
    });

    it('succeeds even if no token matched (idempotent)', async () => {
      const result = await service.unregisterToken(
        'user-uuid',
        'nonexistent-token',
      );

      expect(result).toEqual({ message: 'Push token removed.' });
    });
  });

  describe('sendPush (NotificationPayload)', () => {
    const notification = {
      id: 'notif-1',
      category: 'message',
      type: 'mention',
      title: 'New mention',
      body: 'You were mentioned in #general',
      actionUrl: '/channels/general',
      channelId: 'ch-1',
      messageId: 'msg-1',
      actor: {
        id: 'actor-1',
        username: 'alice',
        displayName: 'Alice',
        avatarUrl: 'https://example.com/alice.png',
      },
    };

    it('sends push notifications to all user tokens via Expo API', async () => {
      db.where.mockResolvedValueOnce([TOKEN_ROW, TOKEN_ROW_2]);

      const mockTickets: ExpoPushTicket[] = [
        { status: 'ok', id: 'ticket-1' },
        { status: 'ok', id: 'ticket-2' },
      ];

      globalThis.fetch = jest.fn<any>().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockTickets }),
      });

      await service.sendPush('user-uuid', notification);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://exp.host/--/api/v2/push/send',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );

      const fetchCall = (globalThis.fetch as MockFn).mock.calls[0];
      const sentBody = JSON.parse(fetchCall[1].body as string);
      expect(sentBody).toHaveLength(2);
      expect(sentBody[0].to).toBe('ExponentPushToken[abc123]');
      expect(sentBody[0].title).toBe('New mention');
      expect(sentBody[0].body).toBe('You were mentioned in #general');
      expect(sentBody[0].data).toEqual({
        type: 'mention',
        category: 'message',
        actionUrl: '/channels/general',
        channelId: 'ch-1',
        messageId: 'msg-1',
      });
      expect(sentBody[0].sound).toBe('default');
      expect(sentBody[1].to).toBe('ExponentPushToken[xyz789]');
    });

    it('does nothing when the user has no tokens', async () => {
      db.where.mockResolvedValueOnce([]);

      globalThis.fetch = jest.fn<any>();

      await service.sendPush('user-uuid', notification);

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('removes invalid tokens reported as DeviceNotRegistered', async () => {
      db.where.mockResolvedValueOnce([TOKEN_ROW, TOKEN_ROW_2]);

      const mockTickets: ExpoPushTicket[] = [
        {
          status: 'error',
          message: 'DeviceNotRegistered',
          details: { error: 'DeviceNotRegistered' },
        },
        { status: 'ok', id: 'ticket-2' },
      ];

      globalThis.fetch = jest.fn<any>().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockTickets }),
      });

      await service.sendPush('user-uuid', notification);

      // The service should delete the invalid token
      expect(db.delete).toHaveBeenCalled();
    });

    it('handles Expo API network errors gracefully', async () => {
      db.where.mockResolvedValueOnce([TOKEN_ROW]);

      globalThis.fetch = jest
        .fn<any>()
        .mockRejectedValue(new Error('Network error'));

      // Should not throw
      await service.sendPush('user-uuid', notification);
    });

    it('handles Expo API non-OK response gracefully', async () => {
      db.where.mockResolvedValueOnce([TOKEN_ROW]);

      globalThis.fetch = jest.fn<any>().mockResolvedValue({
        ok: false,
        status: 500,
      });

      // Should not throw
      await service.sendPush('user-uuid', notification);
    });

    it('handles null body in notification payload', async () => {
      db.where.mockResolvedValueOnce([TOKEN_ROW]);

      const mockTickets: ExpoPushTicket[] = [{ status: 'ok', id: 'ticket-1' }];

      globalThis.fetch = jest.fn<any>().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockTickets }),
      });

      await service.sendPush('user-uuid', {
        ...notification,
        body: null,
        actionUrl: null,
        channelId: null,
        messageId: null,
      });

      const fetchCall = (globalThis.fetch as MockFn).mock.calls[0];
      const sentBody = JSON.parse(fetchCall[1].body as string);
      expect(sentBody[0].body).toBeUndefined();
      expect(sentBody[0].data.actionUrl).toBeUndefined();
      expect(sentBody[0].data.channelId).toBeUndefined();
      expect(sentBody[0].data.messageId).toBeUndefined();
    });
  });

  describe('sendToExpo', () => {
    it('returns parsed ticket data on success', async () => {
      const mockTickets: ExpoPushTicket[] = [{ status: 'ok', id: 'ticket-1' }];

      globalThis.fetch = jest.fn<any>().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockTickets }),
      });

      const result = await service.sendToExpo([
        { to: 'ExponentPushToken[abc123]', title: 'Test', body: 'Hello' },
      ]);

      expect(result).toEqual(mockTickets);
    });

    it('returns empty array on network failure', async () => {
      globalThis.fetch = jest
        .fn<any>()
        .mockRejectedValue(new Error('Network error'));

      const result = await service.sendToExpo([
        { to: 'ExponentPushToken[abc123]', title: 'Test', body: 'Hello' },
      ]);

      expect(result).toEqual([]);
    });

    it('returns empty array on non-OK response', async () => {
      globalThis.fetch = jest.fn<any>().mockResolvedValue({
        ok: false,
        status: 429,
      });

      const result = await service.sendToExpo([
        { to: 'ExponentPushToken[abc123]', title: 'Test', body: 'Hello' },
      ]);

      expect(result).toEqual([]);
    });

    it('returns empty array when response data is missing', async () => {
      globalThis.fetch = jest.fn<any>().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await service.sendToExpo([
        { to: 'ExponentPushToken[abc123]', title: 'Test', body: 'Hello' },
      ]);

      expect(result).toEqual([]);
    });
  });

  describe('removeInvalidTokens', () => {
    it('deletes each invalid token from the database', async () => {
      await service.removeInvalidTokens([
        'ExponentPushToken[abc123]',
        'ExponentPushToken[xyz789]',
      ]);

      // Called once per token
      expect(db.delete).toHaveBeenCalledTimes(2);
    });

    it('handles empty array gracefully', async () => {
      await service.removeInvalidTokens([]);

      expect(db.delete).not.toHaveBeenCalled();
    });

    it('continues removing remaining tokens even if one deletion fails', async () => {
      db.where
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce([]);

      // Should not throw despite the first deletion failing
      await service.removeInvalidTokens([
        'ExponentPushToken[bad]',
        'ExponentPushToken[good]',
      ]);

      expect(db.delete).toHaveBeenCalledTimes(2);
    });
  });
});
