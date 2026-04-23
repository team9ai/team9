import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';

// ─── Mock @team9/database ────────────────────────────────────────────────────

const mockEq = jest.fn((f: unknown, v: unknown) => ({ kind: 'eq', f, v }));
const mockAnd = jest.fn((...c: unknown[]) => ({ kind: 'and', c }));

const noop = jest.fn((..._args: unknown[]) => ({}));
jest.unstable_mockModule('@team9/database', () => ({
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: mockEq,
  and: mockAnd,
  // Provide no-op stubs for all drizzle helpers used by transitive imports
  ne: noop,
  or: noop,
  lt: noop,
  lte: noop,
  gt: noop,
  gte: noop,
  sql: noop,
  like: noop,
  desc: noop,
  asc: noop,
  isNull: noop,
  inArray: noop,
  notInArray: noop,
  aliasedTable: noop,
  alias: noop,
  DatabaseModule: class DatabaseModule {},
}));

jest.unstable_mockModule('@team9/database/schemas', () => ({
  ahandDevices: {
    hubDeviceId: 'ahandDevices.hubDeviceId',
    status: 'ahandDevices.status',
    revokedAt: 'ahandDevices.revokedAt',
    lastSeenAt: 'ahandDevices.lastSeenAt',
  },
}));

const SECRET = 'webhook-secret-key-32chars-long!!';
const mockSharedEnv = { AHAND_HUB_WEBHOOK_SECRET: SECRET };
// Re-export WS_EVENTS so transitive imports (workspace.service → websocket.module)
// don't blow up when @team9/shared is mocked.
const actualShared = await import('@team9/shared');
jest.unstable_mockModule('@team9/shared', () => ({
  ...actualShared,
  env: mockSharedEnv,
}));

const { AhandWebhookService } = await import('./ahand-webhook.service.js');
type Svc = InstanceType<typeof AhandWebhookService>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

function makeDbMock() {
  const updateReturning: MockFn = jest.fn<any>().mockResolvedValue([]);
  // updateWhere returns an object that is both awaitable (thenable) and has .returning().
  // This mirrors Drizzle's QueryBuilder which supports both patterns.
  const updateWhere: MockFn = jest.fn<any>().mockImplementation(() => {
    const thenable = Promise.resolve(undefined) as any;
    thenable.returning = updateReturning;
    return thenable;
  });
  const updateSet = jest.fn<any>().mockReturnValue({ where: updateWhere });
  const selectWhere: MockFn = jest.fn<any>().mockResolvedValue([]);
  const selectFrom = jest.fn<any>().mockReturnValue({ where: selectWhere });

  return {
    db: {
      update: jest.fn<any>().mockReturnValue({ set: updateSet }),
      select: jest.fn<any>().mockReturnValue({ from: selectFrom }),
    },
    chains: {
      updateSet,
      updateWhere,
      updateReturning,
      selectFrom,
      selectWhere,
    },
  };
}

function makeRedis() {
  const store = new Map<string, { val: string; ex?: number }>();
  return {
    set: jest.fn<any>().mockImplementation(async (...args: string[]) => {
      const [key, val, ...rest] = args;
      const nxIdx = rest.indexOf('NX');
      if (nxIdx >= 0 && store.has(key)) return null;
      store.set(key, { val });
      return 'OK';
    }),
    get: jest.fn<any>().mockImplementation(async (key: string) => {
      return store.get(key)?.val ?? null;
    }),
    del: jest.fn<any>().mockImplementation(async (key: string) => {
      const had = store.has(key);
      store.delete(key);
      return had ? 1 : 0;
    }),
    _store: store,
  };
}

function makePublisher() {
  return { publishForOwner: jest.fn<any>().mockResolvedValue(undefined) };
}

function makeEventsGateway() {
  return { emitToOwner: jest.fn<any>() };
}

/**
 * Stripe-style HMAC: HMAC-SHA256(secret, `${timestamp}.${body}`).
 * Matches Stream A's hub webhook sender.
 */
function sign(body: string, timestamp: string): string {
  return (
    'sha256=' +
    createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex')
  );
}

/**
 * Legacy body-only HMAC input, kept for regression testing that such
 * signatures are now rejected.
 */
function signLegacyBodyOnly(body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
}

function nowSec() {
  return String(Math.floor(Date.now() / 1000));
}

function makeDeviceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    ownerType: 'user',
    ownerId: 'u1',
    hubDeviceId: 'h1',
    publicKey: 'pk',
    nickname: 'MacBook',
    platform: 'macos',
    hostname: null,
    status: 'active',
    lastSeenAt: null,
    createdAt: new Date('2026-04-22'),
    revokedAt: null,
    ...overrides,
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('AhandWebhookService', () => {
  let svc: Svc;
  let dbFixture: ReturnType<typeof makeDbMock>;
  let redis: ReturnType<typeof makeRedis>;
  let publisher: ReturnType<typeof makePublisher>;
  let eventsGw: ReturnType<typeof makeEventsGateway>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSharedEnv.AHAND_HUB_WEBHOOK_SECRET = SECRET;
    dbFixture = makeDbMock();
    redis = makeRedis();
    publisher = makePublisher();
    eventsGw = makeEventsGateway();
    svc = new AhandWebhookService(
      dbFixture.db as never,
      redis as never,
      publisher as never,
      eventsGw as never,
    );
  });

  // ─── verifySignature ─────────────────────────────────────────────────────

  describe('verifySignature', () => {
    const body = Buffer.from(JSON.stringify({ eventId: 'evt_1' }));

    it('accepts valid Stripe-style signature + fresh timestamp', () => {
      const ts = nowSec();
      expect(() =>
        svc.verifySignature(body, sign(body.toString(), ts), ts),
      ).not.toThrow();
    });

    it('rejects legacy body-only HMAC (must be {ts}.{body})', () => {
      expect(() =>
        svc.verifySignature(
          body,
          signLegacyBodyOnly(body.toString()),
          nowSec(),
        ),
      ).toThrow(UnauthorizedException);
    });

    it('rejects signature computed with a different timestamp (tamper guard)', () => {
      const ts1 = nowSec();
      const ts2 = String(Math.floor(Date.now() / 1000) + 10);
      // Sign with ts1, verify with ts2 — should fail even if ts2 is within skew.
      expect(() =>
        svc.verifySignature(body, sign(body.toString(), ts1), ts2),
      ).toThrow(UnauthorizedException);
    });

    it('rejects missing signature header', () => {
      expect(() => svc.verifySignature(body, undefined, nowSec())).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects empty string signature', () => {
      expect(() => svc.verifySignature(body, '', nowSec())).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects non-sha256= prefix', () => {
      expect(() => svc.verifySignature(body, 'md5=abc', nowSec())).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects signature tampering (wrong HMAC value, same length)', () => {
      expect(() =>
        svc.verifySignature(body, 'sha256=' + '0'.repeat(64), nowSec()),
      ).toThrow(UnauthorizedException);
    });

    it('rejects wrong-length hex in signature (length mismatch fast-path)', () => {
      expect(() =>
        svc.verifySignature(body, 'sha256=' + 'a'.repeat(10), nowSec()),
      ).toThrow(UnauthorizedException);
    });

    it('rejects signature with non-hex characters', () => {
      const body2 = Buffer.from('test');
      expect(() =>
        svc.verifySignature(body2, 'sha256=' + 'g'.repeat(64), nowSec()),
      ).toThrow(UnauthorizedException);
    });

    it('rejects timestamp older than 5 min', () => {
      const old = String(Math.floor(Date.now() / 1000) - 400);
      expect(() =>
        svc.verifySignature(body, sign(body.toString(), old), old),
      ).toThrow(UnauthorizedException);
    });

    it('rejects timestamp from the future beyond skew', () => {
      const future = String(Math.floor(Date.now() / 1000) + 400);
      expect(() =>
        svc.verifySignature(body, sign(body.toString(), future), future),
      ).toThrow(UnauthorizedException);
    });

    it('rejects non-numeric timestamp', () => {
      expect(() =>
        svc.verifySignature(
          body,
          sign(body.toString(), 'not-a-number'),
          'not-a-number',
        ),
      ).toThrow(UnauthorizedException);
    });

    it('rejects missing timestamp header', () => {
      const ts = nowSec();
      expect(() =>
        svc.verifySignature(body, sign(body.toString(), ts), undefined),
      ).toThrow(UnauthorizedException);
    });

    it('throws when AHAND_HUB_WEBHOOK_SECRET is not configured', () => {
      mockSharedEnv.AHAND_HUB_WEBHOOK_SECRET = '';
      const ts = nowSec();
      expect(() =>
        svc.verifySignature(body, sign(body.toString(), ts), ts),
      ).toThrow(Error);
    });
  });

  // ─── dedupe / clearDedupe ────────────────────────────────────────────────

  describe('dedupe + clearDedupe', () => {
    it('returns true first time, false on duplicate', async () => {
      expect(await svc.dedupe('evt_1')).toBe(true);
      expect(await svc.dedupe('evt_1')).toBe(false);
    });

    it('clearDedupe removes key so next dedupe succeeds', async () => {
      await svc.dedupe('evt_2');
      await svc.clearDedupe('evt_2');
      expect(await svc.dedupe('evt_2')).toBe(true);
    });

    it('clearDedupe swallows redis.del errors', async () => {
      redis.del.mockRejectedValue(new Error('redis down'));
      await expect(svc.clearDedupe('evt_x')).resolves.toBeUndefined();
    });
  });

  // ─── handleEvent ────────────────────────────────────────────────────────

  function baseEvt(eventType: string, overrides: Record<string, unknown> = {}) {
    return {
      eventId: 'evt_x',
      eventType,
      occurredAt: new Date().toISOString(),
      deviceId: 'h1',
      externalUserId: 'u1',
      data: {},
      ...overrides,
    } as any;
  }

  describe('device.online', () => {
    it('sets presence with TTL, updates lastSeenAt, fans out', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([makeDeviceRow()]);
      await svc.handleEvent(
        baseEvt('device.online', { data: { presenceTtlSeconds: 60 } }),
      );
      expect(await redis.get('ahand:device:h1:presence')).toBe('online');
      expect(dbFixture.db.update).toHaveBeenCalledTimes(1);
      expect(dbFixture.chains.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ lastSeenAt: expect.any(Date) }),
      );
      expect(redis.set).toHaveBeenCalledWith(
        'ahand:device:h1:presence',
        'online',
        'EX',
        60,
      );
      expect(publisher.publishForOwner).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'device.online',
          ownerType: 'user',
          ownerId: 'u1',
        }),
      );
      expect(eventsGw.emitToOwner).toHaveBeenCalledWith(
        'user',
        'u1',
        'device.online',
        expect.any(Object),
      );
    });

    it('uses default TTL 180 when presenceTtlSeconds absent', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([makeDeviceRow()]);
      await svc.handleEvent(baseEvt('device.online'));
      expect(redis.set).toHaveBeenCalledWith(
        'ahand:device:h1:presence',
        'online',
        'EX',
        180,
      );
    });

    it('device.online: caps presenceTtlSeconds to 3600 when provided value is larger', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([makeDeviceRow()]);
      await svc.handleEvent(
        baseEvt('device.online', { data: { presenceTtlSeconds: 99999 } }),
      );
      expect(redis.set).toHaveBeenCalledWith(
        'ahand:device:h1:presence',
        'online',
        'EX',
        3600,
      );
    });
  });

  describe('device.heartbeat', () => {
    it('refreshes presence TTL but does NOT update lastSeenAt', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([makeDeviceRow()]);
      await svc.handleEvent(
        baseEvt('device.heartbeat', { data: { presenceTtlSeconds: 30 } }),
      );
      expect(await redis.get('ahand:device:h1:presence')).toBe('online');
      // update() should NOT have been called (no lastSeenAt write)
      expect(dbFixture.db.update).not.toHaveBeenCalled();
      expect(publisher.publishForOwner).not.toHaveBeenCalled();
      expect(eventsGw.emitToOwner).not.toHaveBeenCalled();
    });

    it('uses default TTL 180 when presenceTtlSeconds absent', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([makeDeviceRow()]);
      await svc.handleEvent(baseEvt('device.heartbeat'));
      expect(redis.set).toHaveBeenCalledWith(
        'ahand:device:h1:presence',
        'online',
        'EX',
        180,
      );
    });
  });

  describe('device.offline', () => {
    it('deletes presence key, updates lastSeenAt', async () => {
      redis._store.set('ahand:device:h1:presence', { val: 'online' });
      dbFixture.chains.selectWhere.mockResolvedValue([makeDeviceRow()]);
      await svc.handleEvent(baseEvt('device.offline'));
      expect(await redis.get('ahand:device:h1:presence')).toBeNull();
      expect(dbFixture.db.update).toHaveBeenCalledTimes(1);
      expect(dbFixture.chains.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ lastSeenAt: expect.any(Date) }),
      );
      expect(publisher.publishForOwner).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'device.offline',
          ownerType: 'user',
          ownerId: 'u1',
        }),
      );
      expect(eventsGw.emitToOwner).toHaveBeenCalledWith(
        'user',
        'u1',
        'device.offline',
        expect.any(Object),
      );
    });
  });

  describe('device.revoked', () => {
    it('deletes presence, flips DB status + revokedAt', async () => {
      redis._store.set('ahand:device:h1:presence', { val: 'online' });
      dbFixture.chains.selectWhere.mockResolvedValue([makeDeviceRow()]);
      // updateReturning returns a non-empty array so the active→revoked transition is detected.
      dbFixture.chains.updateReturning.mockResolvedValue([makeDeviceRow()]);
      await svc.handleEvent(baseEvt('device.revoked'));
      expect(await redis.get('ahand:device:h1:presence')).toBeNull();
      expect(dbFixture.chains.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'revoked',
          revokedAt: expect.any(Date),
        }),
      );
      // Issue 4: verify update was called exactly once
      expect(dbFixture.db.update).toHaveBeenCalledTimes(1);
      // Issue 6: verify WHERE clause includes hubDeviceId filter
      expect(mockEq).toHaveBeenCalledWith('ahandDevices.hubDeviceId', 'h1');
      expect(publisher.publishForOwner).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'device.revoked',
          ownerType: 'user',
          ownerId: 'u1',
        }),
      );
      expect(eventsGw.emitToOwner).toHaveBeenCalledWith(
        'user',
        'u1',
        'device.revoked',
        expect.any(Object),
      );
    });

    it('device.revoked: already-revoked device skips fan-out (idempotent)', async () => {
      // updateReturning returns [] meaning no rows were transitioned
      dbFixture.chains.updateReturning.mockResolvedValue([]);
      await svc.handleEvent(baseEvt('device.revoked'));
      expect(publisher.publishForOwner).not.toHaveBeenCalled();
      expect(eventsGw.emitToOwner).not.toHaveBeenCalled();
    });
  });

  describe('device.registered', () => {
    it('no DB writes, only fan-out', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([makeDeviceRow()]);
      await svc.handleEvent(baseEvt('device.registered'));
      expect(dbFixture.db.update).not.toHaveBeenCalled();
      expect(publisher.publishForOwner).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'device.registered' }),
      );
    });
  });

  describe('unknown deviceId', () => {
    it('logs and skips fan-out without throwing', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([]);
      await expect(
        svc.handleEvent(baseEvt('device.online')),
      ).resolves.toBeUndefined();
      expect(publisher.publishForOwner).not.toHaveBeenCalled();
      expect(eventsGw.emitToOwner).not.toHaveBeenCalled();
    });

    it('device.online with unknown deviceId: sets presence but skips updateLastSeen and fan-out', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([]); // no row
      await svc.handleEvent(
        baseEvt('device.online', { data: { presenceTtlSeconds: 60 } }),
      );
      // Presence key IS set (hub confirmed the device is online)
      expect(await redis.get('ahand:device:h1:presence')).toBe('online');
      // But NO DB update (no lastSeenAt write for unknown device)
      expect(dbFixture.db.update).not.toHaveBeenCalled();
      // And NO fan-out
      expect(publisher.publishForOwner).not.toHaveBeenCalled();
      expect(eventsGw.emitToOwner).not.toHaveBeenCalled();
    });
  });
});
