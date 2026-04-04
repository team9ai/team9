import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PushSubscriptionService } from './push-subscription.service.js';
import { DATABASE_CONNECTION } from '@team9/database';

// ── helpers ──────────────────────────────────────────────────────────

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
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.returning.mockResolvedValue([]);
  chain.where.mockResolvedValue([]);
  return chain;
}

const SUBSCRIPTION_ROW = {
  id: 'sub-uuid-1',
  userId: 'user-uuid',
  endpoint: 'https://push.example.com/sub/abc',
  p256dh: 'test-p256dh-key',
  auth: 'test-auth-key',
  userAgent: 'Mozilla/5.0 Test',
  createdAt: new Date('2026-01-01'),
  lastUsedAt: null,
};

describe('PushSubscriptionService', () => {
  let service: PushSubscriptionService;
  let db: ReturnType<typeof mockDb>;

  beforeEach(async () => {
    db = mockDb();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PushSubscriptionService,
        { provide: DATABASE_CONNECTION, useValue: db },
      ],
    }).compile();

    service = module.get<PushSubscriptionService>(PushSubscriptionService);
  });

  // ── subscribe ──────────────────────────────────────────────────────

  describe('subscribe', () => {
    it('should upsert a push subscription and return it', async () => {
      db.returning.mockResolvedValue([SUBSCRIPTION_ROW]);

      const dto = {
        endpoint: 'https://push.example.com/sub/abc',
        keys: { p256dh: 'test-p256dh-key', auth: 'test-auth-key' },
      };

      const result = await service.subscribe(
        'user-uuid',
        dto,
        'Mozilla/5.0 Test',
      );

      expect(db.insert).toHaveBeenCalled();
      expect(db.values).toHaveBeenCalledWith({
        userId: 'user-uuid',
        endpoint: 'https://push.example.com/sub/abc',
        p256dh: 'test-p256dh-key',
        auth: 'test-auth-key',
        userAgent: 'Mozilla/5.0 Test',
      });
      expect(db.onConflictDoUpdate).toHaveBeenCalled();
      expect(result).toEqual(SUBSCRIPTION_ROW);
    });

    it('should set userAgent to null when not provided', async () => {
      db.returning.mockResolvedValue([SUBSCRIPTION_ROW]);

      const dto = {
        endpoint: 'https://push.example.com/sub/abc',
        keys: { p256dh: 'test-p256dh-key', auth: 'test-auth-key' },
      };

      await service.subscribe('user-uuid', dto);

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({ userAgent: null }),
      );
    });

    it('should throw ConflictException when endpoint belongs to another user', async () => {
      // setWhere prevents the update; RETURNING returns empty array
      db.returning.mockResolvedValue([]);

      const dto = {
        endpoint: 'https://push.example.com/sub/abc',
        keys: { p256dh: 'test-p256dh-key', auth: 'test-auth-key' },
      };

      await expect(service.subscribe('user-uuid', dto)).rejects.toThrow(
        'Push endpoint already registered by another account',
      );
    });

    it('should set userAgent to null when empty string provided', async () => {
      db.returning.mockResolvedValue([SUBSCRIPTION_ROW]);

      const dto = {
        endpoint: 'https://push.example.com/sub/abc',
        keys: { p256dh: 'p', auth: 'a' },
      };

      await service.subscribe('user-uuid', dto, '');

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({ userAgent: null }),
      );
    });
  });

  // ── unsubscribe ────────────────────────────────────────────────────

  describe('unsubscribe', () => {
    it('should delete by endpoint scoped to user', async () => {
      await service.unsubscribe(
        'https://push.example.com/sub/abc',
        'user-uuid',
      );

      expect(db.delete).toHaveBeenCalled();
      expect(db.where).toHaveBeenCalled();
    });
  });

  // ── unsubscribeAll ─────────────────────────────────────────────────

  describe('unsubscribeAll', () => {
    it('should delete all subscriptions for a user', async () => {
      await service.unsubscribeAll('user-uuid');

      expect(db.delete).toHaveBeenCalled();
      expect(db.where).toHaveBeenCalled();
    });
  });

  // ── getSubscriptions ───────────────────────────────────────────────

  describe('getSubscriptions', () => {
    it('should return all subscriptions for a user', async () => {
      const rows = [
        SUBSCRIPTION_ROW,
        { ...SUBSCRIPTION_ROW, id: 'sub-uuid-2' },
      ];
      db.where.mockResolvedValue(rows);

      const result = await service.getSubscriptions('user-uuid');

      expect(db.select).toHaveBeenCalled();
      expect(db.from).toHaveBeenCalled();
      expect(db.where).toHaveBeenCalled();
      expect(result).toEqual(rows);
    });

    it('should return empty array when user has no subscriptions', async () => {
      db.where.mockResolvedValue([]);

      const result = await service.getSubscriptions('user-uuid');

      expect(result).toEqual([]);
    });
  });

  // ── removeSubscription ─────────────────────────────────────────────

  describe('removeSubscription', () => {
    it('should delete by ID', async () => {
      await service.removeSubscription('sub-uuid-1');

      expect(db.delete).toHaveBeenCalled();
      expect(db.where).toHaveBeenCalled();
    });
  });

  // ── updateLastUsed ─────────────────────────────────────────────────

  describe('updateLastUsed', () => {
    it('should update the lastUsedAt timestamp', async () => {
      db.where.mockResolvedValue(undefined);

      await service.updateLastUsed('sub-uuid-1');

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalled();
      expect(db.where).toHaveBeenCalled();
    });
  });
});
