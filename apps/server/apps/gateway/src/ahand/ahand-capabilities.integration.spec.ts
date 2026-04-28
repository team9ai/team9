/**
 * Integration spec: ahand capabilities flow
 *
 * Exercises the full capabilities flow end-to-end at the service layer:
 *   Test 1 — webhook → DB → list-for-user
 *     Pre-register a device, then POST a device.online webhook with
 *     capabilities. Assert the DB is updated and list-for-user returns
 *     the capabilities.
 *
 *   Test 2 — cold-start backfill on register
 *     Pre-configure the hub mock to return capabilities from its admin
 *     endpoint. Register a device and let the detached backfill settle.
 *     Assert list-for-user returns the capabilities.
 *
 * Harness conventions
 * -------------------
 * All external dependencies (AhandHubClient, AhandRedisPublisher,
 * AhandEventsGateway, Redis) are mocked. The DB is simulated via a
 * stateful in-memory store so that writes from one service are visible
 * to reads in another — giving real multi-layer integration coverage.
 * This follows the mock-DB pattern used throughout the gateway test suite
 * (see ahand-webhook.service.spec.ts).
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// ─── ESM module mocks ─────────────────────────────────────────────────────────

const mockEq = jest.fn((field: unknown, value: unknown) => ({
  _kind: 'eq',
  field,
  value,
}));
const mockAnd = jest.fn((...conds: unknown[]) => ({ _kind: 'and', conds }));
const mockInArray = jest.fn((field: unknown, values: unknown[]) => ({
  _kind: 'inArray',
  field,
  values,
}));

// Noop stubs for all drizzle helpers used by transitive imports
// (same pattern as ahand-webhook.service.spec.ts).
const noop = jest.fn((..._args: unknown[]) => ({}));

jest.unstable_mockModule('@team9/database', () => ({
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: mockEq,
  and: mockAnd,
  inArray: mockInArray,
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
  notInArray: noop,
  aliasedTable: noop,
  alias: noop,
  DatabaseModule: class DatabaseModule {},
}));

jest.unstable_mockModule('@team9/database/schemas', () => ({
  ahandDevices: {
    id: 'ahandDevices.id',
    ownerType: 'ahandDevices.ownerType',
    ownerId: 'ahandDevices.ownerId',
    hubDeviceId: 'ahandDevices.hubDeviceId',
    status: 'ahandDevices.status',
    capabilities: 'ahandDevices.capabilities',
    lastSeenAt: 'ahandDevices.lastSeenAt',
    revokedAt: 'ahandDevices.revokedAt',
  },
}));

const mockEnv = {
  AHAND_HUB_URL: 'https://hub.test',
  AHAND_HUB_WEBHOOK_SECRET: 'integration-test-secret',
};
const actualShared = await import('@team9/shared');
jest.unstable_mockModule('@team9/shared', () => ({
  ...actualShared,
  env: mockEnv,
}));

// ─── Lazy service imports (after mocks are registered) ────────────────────────

const { AhandDevicesService } = await import('./ahand.service.js');
const { AhandWebhookService } = await import('./ahand-webhook.service.js');
const { AhandInternalController } =
  await import('./ahand-internal.controller.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

/** Flush all queued micro/macro tasks so fire-and-forget Promises can settle. */
const flushPromises = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Stateful in-memory device store. Shared between all service instances so
 * writes in AhandWebhookService are visible to reads in AhandDevicesService.
 */
type DeviceRow = {
  id: string;
  ownerType: string;
  ownerId: string;
  hubDeviceId: string;
  publicKey: string;
  nickname: string;
  platform: string;
  hostname: string | null;
  status: string;
  capabilities: string[];
  lastSeenAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
};

function makeDeviceStore() {
  let rows: DeviceRow[] = [];

  /**
   * Apply a filter predicate built from { _kind, field, value } objects
   * produced by our mockEq/mockAnd helpers.
   */
  function matches(row: DeviceRow, filter: unknown): boolean {
    if (!filter || typeof filter !== 'object') return true;
    const f = filter as Record<string, unknown>;
    if (f._kind === 'eq') {
      const col = String(f.field).replace(
        'ahandDevices.',
        '',
      ) as keyof DeviceRow;
      return row[col] === f.value;
    }
    if (f._kind === 'and') {
      return (f.conds as unknown[]).every((c) => matches(row, c));
    }
    return true;
  }

  /** Drizzle chainable mock that operates on `rows`. */
  function makeDb() {
    // --- SELECT chain: select().from().where() → resolves to filtered rows ---
    let selectFilter: unknown = null;
    const selectWhere: MockFn = jest.fn<any>().mockImplementation((filter) => {
      selectFilter = filter;
      return Promise.resolve(rows.filter((r) => matches(r, filter)));
    });
    const selectFrom: MockFn = jest
      .fn<any>()
      .mockReturnValue({ where: selectWhere });
    const select: MockFn = jest.fn<any>().mockReturnValue({ from: selectFrom });

    // --- INSERT chain: insert().values(row).returning() ---
    let pendingInsert: Partial<DeviceRow> | null = null;
    const insertReturning: MockFn = jest.fn<any>().mockImplementation(() => {
      if (!pendingInsert) return Promise.resolve([]);
      const newRow: DeviceRow = {
        id: `row-${Date.now()}-${Math.random()}`,
        ownerType: pendingInsert.ownerType ?? 'user',
        ownerId: pendingInsert.ownerId ?? '',
        hubDeviceId: pendingInsert.hubDeviceId ?? '',
        publicKey: pendingInsert.publicKey ?? '',
        nickname: pendingInsert.nickname ?? '',
        platform: pendingInsert.platform ?? '',
        hostname: pendingInsert.hostname ?? null,
        status: pendingInsert.status ?? 'active',
        capabilities: pendingInsert.capabilities ?? [],
        lastSeenAt: null,
        createdAt: new Date(),
        revokedAt: null,
      };
      rows.push(newRow);
      pendingInsert = null;
      return Promise.resolve([newRow]);
    });
    const insertValues: MockFn = jest.fn<any>().mockImplementation((vals) => {
      pendingInsert = vals as Partial<DeviceRow>;
      return { returning: insertReturning };
    });
    const insert: MockFn = jest
      .fn<any>()
      .mockReturnValue({ values: insertValues });

    // --- UPDATE chain: update().set(patch).where(filter) ---
    // Must be awaitable AND have .returning() (for device.revoked path).
    let pendingPatch: Partial<DeviceRow> | null = null;
    const updateReturning: MockFn = jest.fn<any>().mockImplementation(() => {
      // Not exercised in caps flow tests; return empty for safety.
      return Promise.resolve([]);
    });
    const updateWhere: MockFn = jest.fn<any>().mockImplementation((filter) => {
      if (pendingPatch) {
        for (const row of rows) {
          if (matches(row, filter)) {
            Object.assign(row, pendingPatch);
          }
        }
        pendingPatch = null;
      }
      const thenable: any = Promise.resolve(undefined);
      thenable.returning = updateReturning;
      return thenable;
    });
    const updateSet: MockFn = jest
      .fn<any>()
      .mockImplementation((patch: Partial<DeviceRow>) => {
        pendingPatch = patch;
        return { where: updateWhere };
      });
    const update: MockFn = jest.fn<any>().mockReturnValue({ set: updateSet });

    // --- DELETE chain ---
    const deleteWhere: MockFn = jest.fn<any>().mockImplementation((filter) => {
      rows = rows.filter((r) => !matches(r, filter));
      return Promise.resolve(undefined);
    });
    const del: MockFn = jest.fn<any>().mockReturnValue({ where: deleteWhere });

    return {
      select,
      insert,
      update,
      delete: del,
      // Expose store for assertions
      _rows: () => rows,
      _reset: () => {
        rows = [];
      },
    };
  }

  return { makeDb };
}

// ─── Mock factories ───────────────────────────────────────────────────────────

function makeRedisMock() {
  const store = new Map<string, string>();
  return {
    set: jest.fn<any>().mockImplementation(async (...args: string[]) => {
      const [key, val] = args;
      store.set(key, val);
      return 'OK';
    }),
    get: jest
      .fn<any>()
      .mockImplementation(async (key: string) => store.get(key) ?? null),
    del: jest.fn<any>().mockImplementation(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    mget: jest
      .fn<any>()
      .mockImplementation(async (...keys: string[]) =>
        keys.map((k) => store.get(k) ?? null),
      ),
    _store: store,
  };
}

function makePublisherMock() {
  return { publishForOwner: jest.fn<any>().mockResolvedValue(undefined) };
}

function makeEventsGatewayMock() {
  return { emitToOwner: jest.fn<any>() };
}

function makeHubClientMock() {
  return {
    registerDevice: jest.fn<any>().mockResolvedValue({ deviceId: 'h-default' }),
    mintDeviceToken: jest
      .fn<any>()
      .mockResolvedValue({ token: 'tok', expiresAt: '2099-01-01T00:00:00Z' }),
    deleteDevice: jest.fn<any>().mockResolvedValue(undefined),
    listDevicesForExternalUser: jest.fn<any>().mockResolvedValue([]),
    mintControlPlaneToken: jest
      .fn<any>()
      .mockResolvedValue({ token: 'cp', expiresAt: '2099-01-01T00:00:00Z' }),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ahand capabilities — webhook → DB → list endpoint', () => {
  const store = makeDeviceStore();

  let db: ReturnType<ReturnType<typeof makeDeviceStore>['makeDb']>;
  let redis: ReturnType<typeof makeRedisMock>;
  let publisher: ReturnType<typeof makePublisherMock>;
  let eventsGateway: ReturnType<typeof makeEventsGatewayMock>;
  let hubClient: ReturnType<typeof makeHubClientMock>;

  let devicesSvc: InstanceType<typeof AhandDevicesService>;
  let webhookSvc: InstanceType<typeof AhandWebhookService>;
  let controller: InstanceType<typeof AhandInternalController>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEq.mockImplementation((field: unknown, value: unknown) => ({
      _kind: 'eq',
      field,
      value,
    }));
    mockAnd.mockImplementation((...conds: unknown[]) => ({
      _kind: 'and',
      conds,
    }));

    db = store.makeDb();
    db._reset();

    redis = makeRedisMock();
    publisher = makePublisherMock();
    eventsGateway = makeEventsGatewayMock();
    hubClient = makeHubClientMock();

    devicesSvc = new AhandDevicesService(
      db as never,
      hubClient as never,
      publisher as never,
      redis as never,
    );
    webhookSvc = new AhandWebhookService(
      db as never,
      redis as never,
      publisher as never,
      eventsGateway as never,
    );
    controller = new AhandInternalController(devicesSvc);
  });

  // ─── Test 1: webhook → DB → list ─────────────────────────────────────────

  it('persists caps from device.online webhook and returns them on list-for-user', async () => {
    const HUB_DEVICE_ID = 'h-e2e-webhook';
    const USER_ID = 'user-uuid-e2e';

    // Hub mock returns a minimal record for register; no caps at this point
    // (backfill will see no capabilities from listDevicesForExternalUser).
    hubClient.registerDevice.mockResolvedValue({ deviceId: HUB_DEVICE_ID });
    hubClient.listDevicesForExternalUser.mockResolvedValue([
      { deviceId: HUB_DEVICE_ID /* no capabilities */ },
    ]);

    // 1. Register device — inserts a row via the real stateful DB mock.
    await devicesSvc.registerDeviceForUser(USER_ID, {
      hubDeviceId: HUB_DEVICE_ID,
      publicKey: 'pk-e2e',
      nickname: 'Test Mac',
      platform: 'macos',
    });

    // Verify row exists with empty capabilities initially.
    const afterRegister = await controller.listDevicesForUser({
      userId: USER_ID,
    });
    expect(afterRegister).toHaveLength(1);
    expect(afterRegister[0].capabilities).toEqual([]);

    // 2. Simulate hub sending a device.online webhook with capabilities.
    await webhookSvc.handleEvent({
      eventId: 'evt-e2e-online',
      eventType: 'device.online',
      occurredAt: new Date().toISOString(),
      deviceId: HUB_DEVICE_ID,
      externalUserId: USER_ID,
      data: {
        sentAtMs: Date.now(),
        presenceTtlSeconds: 180,
        capabilities: ['exec', 'browser'],
      },
    } as any);

    // 3. list-for-user must return the persisted capabilities.
    const afterWebhook = await controller.listDevicesForUser({
      userId: USER_ID,
    });
    const device = afterWebhook.find((d) => d.hubDeviceId === HUB_DEVICE_ID);
    expect(device).toBeDefined();
    expect(device!.capabilities).toEqual(['exec', 'browser']);
  });

  // ─── Test 2: cold-start backfill ─────────────────────────────────────────

  it('cold-start backfill: register triggers async hub fetch that populates caps', async () => {
    const HUB_DEVICE_ID = 'h-cold-start';
    const USER_ID = 'user-uuid-cold';

    // Hub mock returns capabilities from its admin list endpoint.
    hubClient.registerDevice.mockResolvedValue({ deviceId: HUB_DEVICE_ID });
    hubClient.listDevicesForExternalUser.mockResolvedValue([
      { deviceId: HUB_DEVICE_ID, capabilities: ['exec', 'browser'] },
    ]);

    // 1. Register device — the detached backfill will call listDevicesForExternalUser
    //    and write the capabilities to the DB row.
    await devicesSvc.registerDeviceForUser(USER_ID, {
      hubDeviceId: HUB_DEVICE_ID,
      publicKey: 'pk-cold',
      nickname: 'Cold Start Box',
      platform: 'linux',
    });

    // 2. Let the detached fire-and-forget backfill Promise settle.
    await flushPromises();

    // 3. list-for-user must return the backfill-populated capabilities.
    const result = await controller.listDevicesForUser({ userId: USER_ID });
    const device = result.find((d) => d.hubDeviceId === HUB_DEVICE_ID);
    expect(device).toBeDefined();
    expect(device!.capabilities).toEqual(['exec', 'browser']);
  });
});
