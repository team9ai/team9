import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

// ─── Mock @team9/database drizzle helpers ─────────────────────────────
//
// We replicate the helper signatures so the service's where-clause building
// produces inspectable structured values (not DB SQL). Tests assert shape.

const mockEq = jest.fn((field: unknown, value: unknown) => ({
  kind: 'eq',
  field,
  value,
}));
const mockAnd = jest.fn((...conditions: unknown[]) => ({
  kind: 'and',
  conditions,
}));
const mockInArray = jest.fn((field: unknown, values: unknown[]) => ({
  kind: 'inArray',
  field,
  values,
}));

jest.unstable_mockModule('@team9/database', () => ({
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: mockEq,
  and: mockAnd,
  inArray: mockInArray,
}));

jest.unstable_mockModule('@team9/database/schemas', () => ({
  ahandDevices: {
    id: 'ahandDevices.id',
    ownerType: 'ahandDevices.ownerType',
    ownerId: 'ahandDevices.ownerId',
    hubDeviceId: 'ahandDevices.hubDeviceId',
    status: 'ahandDevices.status',
  },
}));

const mockEnv = {
  AHAND_HUB_URL: 'https://hub.test',
};

jest.unstable_mockModule('@team9/shared', () => ({
  env: mockEnv,
}));

const { AhandDevicesService } = await import('./ahand.service.js');
type AhandDevicesServiceType = InstanceType<typeof AhandDevicesService>;

// ─── Chainable Drizzle mock ──────────────────────────────────────────
//
// Mirrors the pattern used in resources.service.spec.ts: select/from/where
// resolves to an array, insert/values/returning resolves to an array, etc.

type MockFn = jest.Mock<(...args: any[]) => any>;

function createDbMock() {
  const selectWhere: MockFn = jest.fn<any>().mockResolvedValue([]);
  const selectFrom = jest.fn<any>().mockReturnValue({ where: selectWhere });
  const selectFromDirect = jest.fn<any>().mockResolvedValue([]);

  const insertReturning: MockFn = jest.fn<any>().mockResolvedValue([]);
  const insertValues = jest
    .fn<any>()
    .mockReturnValue({ returning: insertReturning });

  const updateReturning: MockFn = jest.fn<any>().mockResolvedValue([]);
  const updateWhereWithReturning = jest
    .fn<any>()
    .mockReturnValue({ returning: updateReturning });
  // For update() calls that don't chain .returning() (eg revokeDevice).
  // The .where() itself must be awaitable AND still chainable. We model that
  // by making the same function act as both: it returns the same object that
  // has a `returning` chain + is itself a resolvable thenable.
  const updateWhere = jest.fn<any>().mockImplementation(() => {
    const thenable: any = Promise.resolve(undefined);
    thenable.returning = updateReturning;
    return thenable;
  });
  const updateSet = jest.fn<any>().mockReturnValue({ where: updateWhere });

  const deleteWhere: MockFn = jest.fn<any>().mockResolvedValue(undefined);

  const db = {
    select: jest.fn<any>().mockReturnValue({ from: selectFrom }),
    insert: jest.fn<any>().mockReturnValue({ values: insertValues }),
    update: jest.fn<any>().mockReturnValue({ set: updateSet }),
    delete: jest.fn<any>().mockReturnValue({ where: deleteWhere }),
  };

  return {
    db,
    chains: {
      selectFrom,
      selectFromDirect,
      selectWhere,
      insertValues,
      insertReturning,
      updateSet,
      updateWhere,
      updateWhereWithReturning,
      updateReturning,
      deleteWhere,
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function makeDeviceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    ownerType: 'user',
    ownerId: 'u1',
    hubDeviceId: 'hub-d1',
    publicKey: 'pk',
    nickname: 'A',
    platform: 'macos',
    hostname: null,
    status: 'active',
    lastSeenAt: null,
    createdAt: new Date('2026-04-22'),
    revokedAt: null,
    ...overrides,
  };
}

function createHub() {
  return {
    registerDevice: jest.fn<any>(),
    mintDeviceToken: jest.fn<any>(),
    mintControlPlaneToken: jest.fn<any>(),
    deleteDevice: jest.fn<any>(),
    listDevicesForExternalUser: jest.fn<any>(),
    isConfigured: jest.fn<any>().mockReturnValue(true),
  };
}

function createPublisher() {
  return {
    publishForOwner: jest.fn<any>().mockResolvedValue(undefined),
  };
}

function createRedis() {
  return {
    mget: jest.fn<any>().mockResolvedValue([]),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('AhandDevicesService', () => {
  let service: AhandDevicesServiceType;
  let dbFixture: ReturnType<typeof createDbMock>;
  let hub: ReturnType<typeof createHub>;
  let publisher: ReturnType<typeof createPublisher>;
  let redis: ReturnType<typeof createRedis>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEnv.AHAND_HUB_URL = 'https://hub.test';
    dbFixture = createDbMock();
    hub = createHub();
    publisher = createPublisher();
    redis = createRedis();
    service = new AhandDevicesService(
      dbFixture.db as never,
      hub as never,
      publisher as never,
      redis as never,
    );
  });

  // ─── registerDeviceForUser ─────────────────────────────────────────

  describe('registerDeviceForUser - happy path', () => {
    it('creates hub record then DB row then JWT and publishes', async () => {
      hub.registerDevice.mockResolvedValue({ deviceId: 'hub-d1' });
      hub.mintDeviceToken.mockResolvedValue({
        token: 'jwt.xxx',
        expiresAt: '2026-04-29T10:00:00Z',
      });
      const inserted = makeDeviceRow({
        hubDeviceId: 'hub-d1',
        nickname: 'MyMac',
      });
      dbFixture.chains.insertReturning.mockResolvedValue([inserted]);

      const res = await service.registerDeviceForUser('u1', {
        hubDeviceId: 'hub-d1',
        publicKey: 'pk',
        nickname: 'MyMac',
        platform: 'macos',
      });

      expect(res.deviceJwt).toBe('jwt.xxx');
      // Service rewrites the admin HTTPS base to the WebSocket URL that
      // Tauri's ahandd::spawn accepts (see hubWebSocketUrl in the service).
      expect(res.hubUrl).toBe('wss://hub.test/ws');
      expect(res.device.hubDeviceId).toBe('hub-d1');
      expect(hub.registerDevice).toHaveBeenCalledWith({
        deviceId: 'hub-d1',
        publicKey: 'pk',
        externalUserId: 'u1',
      });
      expect(dbFixture.chains.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerType: 'user',
          ownerId: 'u1',
          hubDeviceId: 'hub-d1',
          publicKey: 'pk',
          nickname: 'MyMac',
          platform: 'macos',
          hostname: null,
          status: 'active',
        }),
      );
      expect(publisher.publishForOwner).toHaveBeenCalledWith({
        ownerType: 'user',
        ownerId: 'u1',
        eventType: 'device.registered',
        data: { hubDeviceId: 'hub-d1', nickname: 'MyMac' },
      });
    });

    it('propagates provided hostname', async () => {
      hub.registerDevice.mockResolvedValue({ deviceId: 'd' });
      hub.mintDeviceToken.mockResolvedValue({
        token: 'j',
        expiresAt: 'e',
      });
      dbFixture.chains.insertReturning.mockResolvedValue([makeDeviceRow()]);
      await service.registerDeviceForUser('u1', {
        hubDeviceId: 'd',
        publicKey: 'p',
        nickname: 'n',
        platform: 'macos',
        hostname: 'laptop.local',
      });
      expect(dbFixture.chains.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({ hostname: 'laptop.local' }),
      );
    });
  });

  describe('registerDeviceForUser - error paths', () => {
    it('rejects empty nickname', async () => {
      await expect(
        service.registerDeviceForUser('u1', {
          hubDeviceId: 'd',
          publicKey: 'p',
          nickname: '',
          platform: 'macos',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(hub.registerDevice).not.toHaveBeenCalled();
    });

    it('rejects nickname > 120 chars', async () => {
      await expect(
        service.registerDeviceForUser('u1', {
          hubDeviceId: 'd',
          publicKey: 'p',
          nickname: 'x'.repeat(121),
          platform: 'macos',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects non-string nickname via type guard', async () => {
      await expect(
        service.registerDeviceForUser('u1', {
          hubDeviceId: 'd',
          publicKey: 'p',
          nickname: undefined as unknown as string,
          platform: 'macos',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires AHAND_HUB_URL to be configured', async () => {
      mockEnv.AHAND_HUB_URL = '';
      await expect(
        service.registerDeviceForUser('u1', {
          hubDeviceId: 'd',
          publicKey: 'p',
          nickname: 'n',
          platform: 'macos',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('hub.registerDevice rejection bubbles without compensation', async () => {
      hub.registerDevice.mockRejectedValue(
        new ConflictException('already taken'),
      );
      await expect(
        service.registerDeviceForUser('u1', {
          hubDeviceId: 'd',
          publicKey: 'p',
          nickname: 'n',
          platform: 'macos',
        }),
      ).rejects.toThrow(ConflictException);
      expect(hub.deleteDevice).not.toHaveBeenCalled();
      expect(dbFixture.chains.insertReturning).not.toHaveBeenCalled();
    });

    it('DB insert failure triggers hub DELETE compensation', async () => {
      hub.registerDevice.mockResolvedValue({ deviceId: 'd' });
      hub.deleteDevice.mockResolvedValue(undefined);
      dbFixture.chains.insertReturning.mockRejectedValue(
        new Error('unique violation'),
      );
      await expect(
        service.registerDeviceForUser('u1', {
          hubDeviceId: 'd',
          publicKey: 'p',
          nickname: 'n',
          platform: 'macos',
        }),
      ).rejects.toThrow('unique violation');
      expect(hub.deleteDevice).toHaveBeenCalledWith('d');
    });

    it('DB insert failure + hub compensation failure still rethrows DB error', async () => {
      hub.registerDevice.mockResolvedValue({ deviceId: 'd' });
      hub.deleteDevice.mockRejectedValue(new Error('hub 500'));
      dbFixture.chains.insertReturning.mockRejectedValue(new Error('db nope'));
      await expect(
        service.registerDeviceForUser('u1', {
          hubDeviceId: 'd',
          publicKey: 'p',
          nickname: 'n',
          platform: 'macos',
        }),
      ).rejects.toThrow('db nope');
    });

    it('mintDeviceToken failure cleans up both DB row and hub record', async () => {
      hub.registerDevice.mockResolvedValue({ deviceId: 'd' });
      hub.mintDeviceToken.mockRejectedValue(new Error('hub down'));
      hub.deleteDevice.mockResolvedValue(undefined);
      dbFixture.chains.insertReturning.mockResolvedValue([makeDeviceRow()]);
      await expect(
        service.registerDeviceForUser('u1', {
          hubDeviceId: 'd',
          publicKey: 'p',
          nickname: 'n',
          platform: 'macos',
        }),
      ).rejects.toThrow('hub down');
      expect(dbFixture.chains.deleteWhere).toHaveBeenCalled();
      expect(hub.deleteDevice).toHaveBeenCalledWith('d');
    });

    it('mintDeviceToken cleanup swallows errors from DB delete and hub delete', async () => {
      hub.registerDevice.mockResolvedValue({ deviceId: 'd' });
      hub.mintDeviceToken.mockRejectedValue(new Error('mint err'));
      hub.deleteDevice.mockRejectedValue(new Error('hub err'));
      dbFixture.chains.deleteWhere.mockRejectedValue(new Error('db err'));
      dbFixture.chains.insertReturning.mockResolvedValue([makeDeviceRow()]);
      await expect(
        service.registerDeviceForUser('u1', {
          hubDeviceId: 'd',
          publicKey: 'p',
          nickname: 'n',
          platform: 'macos',
        }),
      ).rejects.toThrow('mint err');
    });

    it('pre-flight throws ConflictException when an active row exists with a different owner or pubkey', async () => {
      // Different owner → not eligible for the idempotent re-register path.
      dbFixture.chains.selectWhere.mockResolvedValue([
        makeDeviceRow({ ownerId: 'different-user' }),
      ]);
      await expect(
        service.registerDeviceForUser('u1', {
          hubDeviceId: 'hub-d1',
          publicKey: 'pk',
          nickname: 'n',
          platform: 'macos',
        }),
      ).rejects.toThrow(ConflictException);
      expect(hub.registerDevice).not.toHaveBeenCalled();
    });

    it('pre-flight returns existing row + fresh JWT for same-owner same-pubkey re-register', async () => {
      const existing = makeDeviceRow();
      dbFixture.chains.selectWhere.mockResolvedValue([existing]);
      hub.mintDeviceToken.mockResolvedValue({
        token: 'new-jwt',
        expiresAt: new Date('2031-01-01').toISOString(),
      });
      const result = await service.registerDeviceForUser('u1', {
        hubDeviceId: 'hub-d1',
        publicKey: 'pk',
        nickname: 'n',
        platform: 'macos',
      });
      expect(result.device).toEqual(existing);
      expect(result.deviceJwt).toBe('new-jwt');
      // Idempotent path skips hub pre-register + DB insert; only mints a JWT.
      expect(hub.registerDevice).not.toHaveBeenCalled();
    });

    it('DB 23505 unique constraint maps to ConflictException and compensates hub', async () => {
      // Pre-flight returns empty (no existing row), so we proceed to hub register
      dbFixture.chains.selectWhere.mockResolvedValue([]);
      hub.registerDevice.mockResolvedValue({ deviceId: 'd' });
      hub.deleteDevice.mockResolvedValue(undefined);
      const uniqueErr = Object.assign(new Error('unique violation'), {
        code: '23505',
      });
      dbFixture.chains.insertReturning.mockRejectedValue(uniqueErr);
      await expect(
        service.registerDeviceForUser('u1', {
          hubDeviceId: 'd',
          publicKey: 'p',
          nickname: 'n',
          platform: 'macos',
        }),
      ).rejects.toThrow(ConflictException);
      expect(hub.deleteDevice).toHaveBeenCalledWith('d');
    });

    it('DB 23505 compensation hub DELETE failure is swallowed', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([]);
      hub.registerDevice.mockResolvedValue({ deviceId: 'd' });
      hub.deleteDevice.mockRejectedValue(new Error('hub gone'));
      const uniqueErr = Object.assign(new Error('unique violation'), {
        code: '23505',
      });
      dbFixture.chains.insertReturning.mockRejectedValue(uniqueErr);
      await expect(
        service.registerDeviceForUser('u1', {
          hubDeviceId: 'd',
          publicKey: 'p',
          nickname: 'n',
          platform: 'macos',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── fireCapabilitiesBackfill (via registerDeviceForUser) ─────────────

  describe('registerDeviceForUser — capabilities backfill', () => {
    // Shared helpers for deferred promises and flushing microtask queue.
    function createDeferred<T>() {
      let resolve!: (v: T) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }
    const flushPromises = () => new Promise<void>((r) => setImmediate(r));

    // Shared happy-path setup: hub register + DB insert + mint all succeed.
    function setupHappyRegister(hubDeviceId = 'hub-d1') {
      hub.registerDevice.mockResolvedValue({ deviceId: hubDeviceId });
      hub.mintDeviceToken.mockResolvedValue({
        token: 'jwt.xxx',
        expiresAt: '2026-04-29T10:00:00Z',
      });
      dbFixture.chains.insertReturning.mockResolvedValue([
        makeDeviceRow({ hubDeviceId }),
      ]);
    }

    it('registerDevice fires backfill without awaiting hub call', async () => {
      setupHappyRegister('hub-d1');

      // Hub listDevicesForExternalUser hangs indefinitely.
      const deferred =
        createDeferred<{ deviceId: string; capabilities: string[] }[]>();
      hub.listDevicesForExternalUser.mockReturnValue(deferred.promise);

      const start = Date.now();
      const result = await service.registerDeviceForUser('u1', {
        hubDeviceId: 'hub-d1',
        publicKey: 'pk',
        nickname: 'MyMac',
        platform: 'macos',
      });
      const elapsed = Date.now() - start;

      // Register returned promptly (well under 50 ms) despite hub hanging.
      expect(elapsed).toBeLessThan(50);
      expect(result.device).toBeDefined();
      expect(result.device.hubDeviceId).toBe('hub-d1');

      // Resolve the hub call now; backfill should write capabilities.
      deferred.resolve([
        { deviceId: 'hub-d1', capabilities: ['exec', 'browser'] },
      ]);
      await flushPromises();

      // The backfill UPDATE should have been called.
      expect(dbFixture.db.update).toHaveBeenCalled();
      expect(dbFixture.chains.updateSet).toHaveBeenCalledWith({
        capabilities: ['exec', 'browser'],
      });
      // Assert WHERE clause contains both hubDeviceId equality AND the
      // status='active' guard — ensures neither can be silently dropped
      // without breaking this test.
      expect(dbFixture.chains.updateWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'and',
          conditions: expect.arrayContaining([
            expect.objectContaining({
              kind: 'eq',
              field: 'ahandDevices.hubDeviceId',
              value: 'hub-d1',
            }),
            expect.objectContaining({
              kind: 'eq',
              field: 'ahandDevices.status',
              value: 'active',
            }),
          ]),
        }),
      );
    });

    it('backfill survives hub error without affecting register', async () => {
      setupHappyRegister('hub-d2');
      hub.listDevicesForExternalUser.mockRejectedValue(new Error('hub down'));

      const result = await service.registerDeviceForUser('u1', {
        hubDeviceId: 'hub-d2',
        publicKey: 'pk',
        nickname: 'MyMac',
        platform: 'macos',
      });

      // Register succeeded despite hub error.
      expect(result.device).toBeDefined();

      await flushPromises();

      // DB update should NOT have been called (backfill failed silently).
      // We check: update() was not called for capabilities (update IS called by
      // other parts, but updateSet should NOT have been called with capabilities).
      const capsCalls = dbFixture.chains.updateSet.mock.calls.filter(
        (args: unknown[]) =>
          typeof args[0] === 'object' &&
          args[0] !== null &&
          'capabilities' in args[0],
      );
      expect(capsCalls).toHaveLength(0);
    });

    it('backfill skips DB update when hub returns no matching device', async () => {
      setupHappyRegister('hub-d3');
      // Hub returns a device but with a different deviceId.
      hub.listDevicesForExternalUser.mockResolvedValue([
        { deviceId: 'unrelated', capabilities: ['exec'] },
      ]);

      const result = await service.registerDeviceForUser('u1', {
        hubDeviceId: 'hub-d3',
        publicKey: 'pk',
        nickname: 'MyMac',
        platform: 'macos',
      });
      expect(result.device).toBeDefined();

      await flushPromises();

      // No capabilities update should have been made.
      const capsCalls = dbFixture.chains.updateSet.mock.calls.filter(
        (args: unknown[]) =>
          typeof args[0] === 'object' &&
          args[0] !== null &&
          'capabilities' in args[0],
      );
      expect(capsCalls).toHaveLength(0);
    });

    it('backfill leaves caps untouched when hub omits the capabilities field', async () => {
      setupHappyRegister('hub-d4');
      // Hub returns matching device but without capabilities field.
      hub.listDevicesForExternalUser.mockResolvedValue([
        { deviceId: 'hub-d4' /* no capabilities */ },
      ]);

      const result = await service.registerDeviceForUser('u1', {
        hubDeviceId: 'hub-d4',
        publicKey: 'pk',
        nickname: 'MyMac',
        platform: 'macos',
      });
      expect(result.device).toBeDefined();

      await flushPromises();

      // No capabilities update should have been made (undefined caps → skip).
      const capsCalls = dbFixture.chains.updateSet.mock.calls.filter(
        (args: unknown[]) =>
          typeof args[0] === 'object' &&
          args[0] !== null &&
          'capabilities' in args[0],
      );
      expect(capsCalls).toHaveLength(0);
    });
  });

  // ─── listDevicesForOwner ────────────────────────────────────────────

  describe('listDevicesForOwner', () => {
    it('empty list short-circuits without Redis', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([]);
      const rows = await service.listDevicesForOwner('user', 'u1');
      expect(rows).toEqual([]);
      expect(redis.mget).not.toHaveBeenCalled();
    });

    it('enriches with presence from mget', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([
        makeDeviceRow({ hubDeviceId: 'd1' }),
        makeDeviceRow({ id: 'row-2', hubDeviceId: 'd2' }),
      ]);
      redis.mget.mockResolvedValue(['online', null]);
      const rows = await service.listDevicesForOwner('user', 'u1', {
        includeOffline: true,
      });
      expect(rows.map((r) => [r.hubDeviceId, r.isOnline])).toEqual([
        ['d1', true],
        ['d2', false],
      ]);
      expect(redis.mget).toHaveBeenCalledWith(
        'ahand:device:d1:presence',
        'ahand:device:d2:presence',
      );
    });

    it('filters out offline by default', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([
        makeDeviceRow({ hubDeviceId: 'd1' }),
        makeDeviceRow({ id: 'row-2', hubDeviceId: 'd2' }),
      ]);
      redis.mget.mockResolvedValue(['online', null]);
      const rows = await service.listDevicesForOwner('user', 'u1');
      expect(rows.map((r) => r.hubDeviceId)).toEqual(['d1']);
    });

    it('Redis outage -> isOnline=null, no throw', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([makeDeviceRow()]);
      redis.mget.mockRejectedValue(new Error('redis down'));
      const rows = await service.listDevicesForOwner('user', 'u1', {
        includeOffline: true,
      });
      expect(rows[0].isOnline).toBeNull();
    });

    it('Redis outage with includeOffline:false — returns all devices with isOnline:null rather than empty list', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([makeDeviceRow()]);
      redis.mget.mockRejectedValue(new Error('redis down'));
      const rows = await service.listDevicesForOwner('user', 'u1', {
        includeOffline: false,
      });
      // Degraded mode: all devices returned with isOnline:null
      expect(rows).toHaveLength(1);
      expect(rows[0].isOnline).toBeNull();
    });

    it('Redis outage with non-Error rejection still degrades gracefully', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([makeDeviceRow()]);

      redis.mget.mockImplementation(async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'raw string';
      });
      const rows = await service.listDevicesForOwner('user', 'u1', {
        includeOffline: true,
      });
      expect(rows[0].isOnline).toBeNull();
    });

    it('includeRevoked=true drops the status filter', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([]);
      await service.listDevicesForOwner('user', 'u1', {
        includeRevoked: true,
      });
      // The `and(...filters)` should only contain ownerType + ownerId,
      // not the status=active equality.
      const lastAndCall = mockAnd.mock.calls.at(-1)!;
      const filterKinds = lastAndCall.map((c: any) => c.field ?? c.kind);
      // With only eq(ownerType) and eq(ownerId) present we expect 2 filters.
      expect(lastAndCall.length).toBe(2);
      expect(filterKinds).toEqual([
        'ahandDevices.ownerType',
        'ahandDevices.ownerId',
      ]);
    });

    it('listActiveDevicesForUser delegates with includeRevoked=false', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([]);
      await service.listActiveDevicesForUser('u1');
      const lastAndCall = mockAnd.mock.calls.at(-1)!;
      expect(lastAndCall.length).toBe(3); // owner type, owner id, status=active
    });

    it('returns capabilities from the persisted column on listActiveDevicesForUser', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([
        makeDeviceRow({ capabilities: ['exec', 'browser'] }),
      ]);
      redis.mget.mockResolvedValue(['online']);
      const [device] = await service.listActiveDevicesForUser('user-uuid', {
        includeOffline: true,
      });
      expect(device.capabilities).toEqual(['exec', 'browser']);
    });

    it('returns empty array when capabilities column has the default', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([
        makeDeviceRow({ capabilities: [] }),
      ]);
      redis.mget.mockResolvedValue(['online']);
      const [device] = await service.listActiveDevicesForUser('user-uuid', {
        includeOffline: true,
      });
      expect(device.capabilities).toEqual([]);
    });
  });

  // ─── refreshDeviceToken / requireOwnedDevice ────────────────────────

  describe('refreshDeviceToken', () => {
    it('happy path returns minted token', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([makeDeviceRow()]);
      hub.mintDeviceToken.mockResolvedValue({
        token: 'jwt.new',
        expiresAt: 'e',
      });
      const res = await service.refreshDeviceToken('u1', 'row-1');
      expect(res.token).toBe('jwt.new');
      expect(hub.mintDeviceToken).toHaveBeenCalledWith({
        deviceId: 'hub-d1',
        ttlSeconds: 7 * 24 * 3600,
      });
    });

    it('NotFound when row missing', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([]);
      await expect(service.refreshDeviceToken('u1', 'row-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('Conflict when device is revoked', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([
        makeDeviceRow({ status: 'revoked' }),
      ]);
      await expect(service.refreshDeviceToken('u1', 'row-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── mintControlPlaneTokenForUser ──────────────────────────────────

  describe('mintControlPlaneTokenForUser', () => {
    it('no deviceIds -> straight to hub mint', async () => {
      hub.mintControlPlaneToken.mockResolvedValue({
        token: 'cp',
        expiresAt: 'e',
      });
      const res = await service.mintControlPlaneTokenForUser('u1');
      expect(res.token).toBe('cp');
      expect(hub.mintControlPlaneToken).toHaveBeenCalledWith({
        externalUserId: 'u1',
        deviceIds: undefined,
        scope: 'jobs:execute',
      });
    });

    it('empty deviceIds array -> straight to hub mint (no DB lookup)', async () => {
      hub.mintControlPlaneToken.mockResolvedValue({
        token: 'cp',
        expiresAt: 'e',
      });
      await service.mintControlPlaneTokenForUser('u1', []);
      expect(dbFixture.db.select).not.toHaveBeenCalled();
    });

    it('owned deviceIds -> hub mint', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([
        makeDeviceRow({ hubDeviceId: 'd1' }),
      ]);
      hub.mintControlPlaneToken.mockResolvedValue({
        token: 'cp',
        expiresAt: 'e',
      });
      await service.mintControlPlaneTokenForUser('u1', ['d1']);
      expect(hub.mintControlPlaneToken).toHaveBeenCalled();
    });

    it('Forbidden when user does not own all deviceIds', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([
        makeDeviceRow({ hubDeviceId: 'd1' }),
      ]);
      await expect(
        service.mintControlPlaneTokenForUser('u1', ['d1', 'd2']),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── patchDevice ────────────────────────────────────────────────────

  describe('patchDevice', () => {
    it('updates nickname when valid', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([
        makeDeviceRow({ nickname: 'Old' }),
      ]);
      dbFixture.chains.updateReturning.mockResolvedValue([
        makeDeviceRow({ nickname: 'New' }),
      ]);
      const res = await service.patchDevice('u1', 'row-1', {
        nickname: 'New',
      });
      expect(res.nickname).toBe('New');
      expect(dbFixture.chains.updateSet).toHaveBeenCalledWith({
        nickname: 'New',
      });
    });

    it('keeps existing nickname when patch omits it', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([
        makeDeviceRow({ nickname: 'Same' }),
      ]);
      dbFixture.chains.updateReturning.mockResolvedValue([
        makeDeviceRow({ nickname: 'Same' }),
      ]);
      await service.patchDevice('u1', 'row-1', {});
      expect(dbFixture.chains.updateSet).toHaveBeenCalledWith({
        nickname: 'Same',
      });
    });

    it('rejects invalid nickname', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([makeDeviceRow()]);
      await expect(
        service.patchDevice('u1', 'row-1', { nickname: '' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── revokeDevice ──────────────────────────────────────────────────

  describe('revokeDevice', () => {
    it('flips status, calls hub, publishes event', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([makeDeviceRow()]);
      hub.deleteDevice.mockResolvedValue(undefined);
      await service.revokeDevice('u1', 'row-1');
      expect(dbFixture.chains.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'revoked',
          revokedAt: expect.any(Date),
        }),
      );
      expect(hub.deleteDevice).toHaveBeenCalledWith('hub-d1');
      expect(publisher.publishForOwner).toHaveBeenCalledWith({
        ownerType: 'user',
        ownerId: 'u1',
        eventType: 'device.revoked',
        data: { hubDeviceId: 'hub-d1' },
      });
    });

    it('hub failure does not throw -- row is already revoked', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([makeDeviceRow()]);
      hub.deleteDevice.mockRejectedValue(new Error('hub-boom'));
      await expect(
        service.revokeDevice('u1', 'row-1'),
      ).resolves.toBeUndefined();
      expect(publisher.publishForOwner).toHaveBeenCalled();
    });

    it('NotFound when row does not belong to user', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([]);
      await expect(service.revokeDevice('u1', 'row-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('publisher failure in revokeDevice is swallowed (fire-and-forget)', async () => {
      dbFixture.chains.selectWhere.mockResolvedValue([makeDeviceRow()]);
      hub.deleteDevice.mockResolvedValue(undefined);
      publisher.publishForOwner.mockRejectedValue(new Error('pub-fail'));
      await expect(
        service.revokeDevice('u1', 'row-1'),
      ).resolves.toBeUndefined();
    });
  });

  // ─── onUserDeleted ──────────────────────────────────────────────────

  describe('onUserDeleted', () => {
    it('no devices -> short-circuit', async () => {
      dbFixture.chains.updateReturning.mockResolvedValue([]);
      await service.onUserDeleted({ userId: 'u-deleted' });
      expect(hub.deleteDevice).not.toHaveBeenCalled();
    });

    it('revokes all active rows and cascades hub DELETEs', async () => {
      dbFixture.chains.updateReturning.mockResolvedValue([
        makeDeviceRow({ hubDeviceId: 'h1' }),
        makeDeviceRow({ id: 'row-2', hubDeviceId: 'h2' }),
      ]);
      hub.deleteDevice.mockResolvedValue(undefined);
      await service.onUserDeleted({ userId: 'u1' });
      expect(dbFixture.chains.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'revoked' }),
      );
      expect(hub.deleteDevice).toHaveBeenCalledTimes(2);
      expect(hub.deleteDevice).toHaveBeenCalledWith('h1');
      expect(hub.deleteDevice).toHaveBeenCalledWith('h2');
    });

    it('hub DELETE failure is logged, cascade continues', async () => {
      dbFixture.chains.updateReturning.mockResolvedValue([
        makeDeviceRow({ hubDeviceId: 'h1' }),
        makeDeviceRow({ id: 'row-2', hubDeviceId: 'h2' }),
      ]);
      hub.deleteDevice
        .mockRejectedValueOnce(new Error('hub-err'))
        .mockResolvedValueOnce(undefined);
      await expect(
        service.onUserDeleted({ userId: 'u1' }),
      ).resolves.toBeUndefined();
      expect(hub.deleteDevice).toHaveBeenCalledTimes(2);
    });

    it('publishes device.revoked event for each cascaded device', async () => {
      dbFixture.chains.updateReturning.mockResolvedValue([
        makeDeviceRow({ hubDeviceId: 'h1' }),
        makeDeviceRow({ id: 'row-2', hubDeviceId: 'h2' }),
      ]);
      hub.deleteDevice.mockResolvedValue(undefined);
      await service.onUserDeleted({ userId: 'u1' });
      expect(publisher.publishForOwner).toHaveBeenCalledTimes(2);
      expect(publisher.publishForOwner).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'device.revoked',
          data: { hubDeviceId: 'h1' },
        }),
      );
      expect(publisher.publishForOwner).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'device.revoked',
          data: { hubDeviceId: 'h2' },
        }),
      );
    });

    it('publisher rejection in onUserDeleted is swallowed (fire-and-forget)', async () => {
      dbFixture.chains.updateReturning.mockResolvedValue([
        makeDeviceRow({ hubDeviceId: 'h1' }),
      ]);
      hub.deleteDevice.mockResolvedValue(undefined);
      publisher.publishForOwner.mockRejectedValue(new Error('publish-boom'));
      await expect(
        service.onUserDeleted({ userId: 'u1' }),
      ).resolves.toBeUndefined();
    });
  });
});
