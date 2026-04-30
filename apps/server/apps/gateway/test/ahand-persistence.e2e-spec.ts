/**
 * Persistence + Redis e2e for the ahand gateway endpoints.
 *
 * Complements `ahand-integration.e2e-spec.ts` (which mocks the service layer
 * to nail wire contracts). This suite drives the controllers + service +
 * webhook handler against a *real* Postgres + Redis to cover the five
 * scenarios from issue #73 / Phase 9 § 9.4.4 that the controller-level
 * suite explicitly skips:
 *
 *   1. Idempotent webhook (Redis-backed dedupe + Socket.io fan-out)
 *   2. Ownership enforcement on /devices/:id/token/refresh (404 not 403)
 *   3. Concurrent register collision → exactly one row wins (DB UNIQUE)
 *   4. Redis outage during list → degrades to isOnline:null, no 500
 *   5. Hub 5xx during register → no DB row left behind, retry succeeds
 *
 * External services
 * -----------------
 * - Postgres: a fresh per-run database is created on the local server
 *   pointed to by env (DB_HOST, DB_PORT, POSTGRES_USER, POSTGRES_PASSWORD)
 *   with sensible localhost defaults. The im_ahand_devices DDL is applied
 *   inline (kept in lockstep with migration 0051_ahand_devices.sql).
 * - Redis: real ioredis client on db=15 (an isolated logical db so flushes
 *   don't clobber dev state). Defaults to localhost:6379.
 * - AhandHubClient is *stubbed* — exercising the real hub admin surface
 *   would push us into ahand-hub e2e territory, which is out of scope.
 *   Stubbing also lets us simulate hub 5xx for scenario 5 deterministically.
 * - AhandEventsGateway and AhandRedisPublisher are stubbed because the
 *   assertions only need to know that fan-out happened, not that Socket.io
 *   actually delivered (Socket.io has its own coverage at the IM-gateway
 *   layer).
 *
 * Skip behaviour
 * --------------
 * The suite no-ops with a single skipped placeholder if Postgres / Redis
 * aren't reachable. CI is expected to expose them via standard service
 * containers; locally `brew services start postgresql@16 redis` is enough.
 */
import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  describe,
  it,
  expect,
  jest,
} from '@jest/globals';
import {
  type INestApplication,
  ValidationPipe,
  type ExecutionContext,
  type CanActivate,
  UnauthorizedException,
  VersioningType,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { json } from 'express';
import { createHmac, randomUUID } from 'node:crypto';
import postgres from 'postgres';

// `postgres` uses `export = postgres` — `Sql` lives on the namespace, not
// as a named export under ESM. Resolve via ReturnType so TS sees a real
// type (the alternative would silently fall through to `any`).
type Sql = ReturnType<typeof postgres>;
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Env wiring — must run BEFORE the ahand modules import @team9/shared, since
// the env proxy reads process.env on every getter call. Setting these here
// is enough; the ahand service / webhook reuse the same getters.
// ---------------------------------------------------------------------------

const TEST_HUB_URL = 'http://hub.test';
const TEST_WEBHOOK_SECRET = 'test-ahand-webhook-secret';

process.env.AHAND_HUB_URL = TEST_HUB_URL;
process.env.AHAND_HUB_SERVICE_TOKEN = 'test-service-token';
process.env.AHAND_HUB_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
process.env.CORS_ORIGIN ??= '*';

const PG_HOST = process.env.DB_HOST ?? 'localhost';
const PG_PORT = Number.parseInt(process.env.DB_PORT ?? '5432', 10);
const PG_USER = process.env.POSTGRES_USER ?? process.env.USER ?? 'postgres';
const PG_PASSWORD = process.env.POSTGRES_PASSWORD ?? '';
const PG_ADMIN_DB = process.env.POSTGRES_ADMIN_DB ?? 'postgres';

const REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
const REDIS_PORT = Number.parseInt(process.env.REDIS_PORT ?? '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
// db=15 is conventional "scratch" — we FLUSHDB it between tests, so isolate
// from any developer state that lives on db=0.
const REDIS_TEST_DB = 15;

// Created at random per run so concurrent CI shards don't collide.
const TEST_DB_NAME = `team9_ahand_e2e_${process.pid}_${Date.now()}`;

// ---------------------------------------------------------------------------
// Reachability probe — drives the skip-vs-run decision below.
// ---------------------------------------------------------------------------

async function pgReachable(): Promise<boolean> {
  // Inferred as Sql; not annotated explicitly because the postgres
  // package's runtime type collapses to `any`, which makes a `Sql | null`
  // annotation trip @typescript-eslint/no-redundant-type-constituents.
  let sql;
  try {
    sql = postgres({
      host: PG_HOST,
      port: PG_PORT,
      database: PG_ADMIN_DB,
      username: PG_USER,
      password: PG_PASSWORD,
      connect_timeout: 2,
      max: 1,
    });
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    if (sql) await sql.end({ timeout: 1 }).catch(() => undefined);
  }
}

async function redisReachable(): Promise<boolean> {
  const probe = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    lazyConnect: true,
    connectTimeout: 2_000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

// We have to decide synchronously whether to install the suite or the skip
// placeholder, because Jest's `describe` boundary is established at
// module-evaluation time. Top-level `await` is allowed under the
// experimental-vm-modules ESM mode the gateway tests run in (see jest-e2e.json).
const REACHABLE = (await pgReachable()) && (await redisReachable());

// ---------------------------------------------------------------------------
// im_ahand_devices DDL — kept in lockstep with
// apps/server/libs/database/migrations/0051_ahand_devices.sql and
// 0053_shallow_shiva.sql (capabilities column). We inline rather than execute
// the migration file because applying the full migration chain pulls in dozens
// of unrelated tables and slows the suite past the 60s budget.
// ---------------------------------------------------------------------------
const AHAND_DEVICES_DDL = `
  CREATE TABLE IF NOT EXISTS "im_ahand_devices" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "owner_type" text NOT NULL,
    "owner_id" uuid NOT NULL,
    "hub_device_id" text NOT NULL,
    "public_key" text NOT NULL,
    "nickname" text NOT NULL,
    "platform" text NOT NULL,
    "hostname" text,
    "capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
    "status" text DEFAULT 'active' NOT NULL,
    "last_seen_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "revoked_at" timestamp,
    CONSTRAINT "im_ahand_devices_hub_device_id_unique" UNIQUE("hub_device_id"),
    CONSTRAINT "im_ahand_devices_owner_type_check" CHECK ("owner_type" IN ('user', 'workspace')),
    CONSTRAINT "im_ahand_devices_status_check" CHECK ("status" IN ('active', 'revoked'))
  );
`;

// ---------------------------------------------------------------------------
// Test guard — same shape used by ahand-integration.e2e-spec.ts.
// ---------------------------------------------------------------------------

class TestAuthGuard implements CanActivate {
  static allow = true;
  static sub = randomUUID();

  canActivate(ctx: ExecutionContext): boolean {
    if (!TestAuthGuard.allow) {
      throw new UnauthorizedException('test guard: denied');
    }
    const req = ctx.switchToHttp().getRequest<{
      user?: { sub: string };
      headers?: Record<string, unknown>;
    }>();
    // Per-request override via header so concurrent supertest calls can
    // authenticate as different users (needed by the concurrent-register
    // collision scenario). Falls back to the static `sub` for the common
    // single-user tests.
    const headerSub = req.headers?.['x-test-user-sub'];
    const sub =
      typeof headerSub === 'string' && headerSub.length > 0
        ? headerSub
        : TestAuthGuard.sub;
    req.user = { sub };
    return true;
  }
}

// Lazy imports so the env wiring above has settled before the modules are
// evaluated. The ahand service reads env.AHAND_HUB_URL via getters at
// runtime, but we still keep this defensive ordering for parity with the
// wiki integration spec.
const { AuthGuard } = await import('@team9/auth');
const { DATABASE_CONNECTION } = await import('@team9/database');
const schema = await import('@team9/database/schemas');
const { REDIS_CLIENT } = await import('@team9/redis');
const { AhandController } = await import('../src/ahand/ahand.controller.js');
const { AhandHubWebhookController } =
  await import('../src/ahand/ahand-webhook.controller.js');
const { AhandDevicesService } = await import('../src/ahand/ahand.service.js');
const { AhandWebhookService } =
  await import('../src/ahand/ahand-webhook.service.js');
const { AhandRedisPublisher } =
  await import('../src/ahand/ahand-redis-publisher.service.js');
const { AhandHubClient } = await import('../src/ahand/ahand-hub.client.js');
const { AhandEventsGateway } =
  await import('../src/ahand/ahand-events.gateway.js');
const { devicePresenceKey, webhookDedupeKey } =
  await import('../src/ahand/ahand-redis-keys.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface HubStub {
  registerDevice: ReturnType<typeof jest.fn>;
  mintDeviceToken: ReturnType<typeof jest.fn>;
  mintControlPlaneToken: ReturnType<typeof jest.fn>;
  deleteDevice: ReturnType<typeof jest.fn>;
}

function makeHubStub(): HubStub {
  return {
    registerDevice: jest.fn().mockResolvedValue(undefined),
    mintDeviceToken: jest.fn().mockResolvedValue({
      token: 'test-device-jwt',
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    }),
    mintControlPlaneToken: jest.fn().mockResolvedValue({
      token: 'test-cp-jwt',
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    }),
    deleteDevice: jest.fn().mockResolvedValue(undefined),
  };
}

interface EventsStub {
  emitToOwner: ReturnType<typeof jest.fn>;
}

function makeEventsStub(): EventsStub {
  return { emitToOwner: jest.fn() };
}

interface PublisherStub {
  publishForOwner: ReturnType<typeof jest.fn>;
}

function makePublisherStub(): PublisherStub {
  return { publishForOwner: jest.fn().mockResolvedValue(undefined) };
}

/** Build a deterministic 64-char lowercase hex hubDeviceId from a seed. */
function fakeHubDeviceId(seed: string): string {
  return createHmac('sha256', 'ahand-e2e').update(seed).digest('hex');
}

const VALID_PUBLIC_KEY = 'YgyIdtmO0d6U74kGLifLI63M/tvitTJK7HAXQuJY9IU=';

/** Sign a webhook payload the way ahand-hub does (Stripe-style). */
function signWebhook(rawBody: Buffer, ts = Math.floor(Date.now() / 1000)) {
  const signingInput = Buffer.concat([Buffer.from(`${ts}.`, 'utf8'), rawBody]);
  const signature =
    'sha256=' +
    createHmac('sha256', TEST_WEBHOOK_SECRET)
      .update(signingInput)
      .digest('hex');
  return { signature, timestamp: String(ts) };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const maybeDescribe = REACHABLE ? describe : describe.skip;

maybeDescribe('Ahand persistence (e2e — real Postgres + Redis)', () => {
  let admin: Sql;
  let client: Sql;
  let db: PostgresJsDatabase<typeof schema>;
  let redis: Redis;
  let app: INestApplication;
  let hub: HubStub;
  let events: EventsStub;
  let publisher: PublisherStub;

  beforeAll(async () => {
    // 1. Create a fresh test database via the admin connection.
    admin = postgres({
      host: PG_HOST,
      port: PG_PORT,
      database: PG_ADMIN_DB,
      username: PG_USER,
      password: PG_PASSWORD,
      max: 1,
      connect_timeout: 5,
    });
    await admin.unsafe(`CREATE DATABASE "${TEST_DB_NAME}"`);

    // 2. Connect to the test DB and apply the table DDL.
    client = postgres({
      host: PG_HOST,
      port: PG_PORT,
      database: TEST_DB_NAME,
      username: PG_USER,
      password: PG_PASSWORD,
      max: 10,
      connect_timeout: 5,
    });
    await client.unsafe(AHAND_DEVICES_DDL);
    db = drizzle(client, { schema });

    // 3. Connect to Redis on the dedicated scratch db.
    redis = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD,
      db: REDIS_TEST_DB,
      maxRetriesPerRequest: 1,
    });
    await redis.flushdb();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (redis) {
      await redis.flushdb().catch(() => undefined);
      redis.disconnect();
    }
    if (client) await client.end({ timeout: 5 }).catch(() => undefined);
    if (admin) {
      // Force-disconnect any lingering sessions so DROP DATABASE can run.
      await admin
        .unsafe(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB_NAME}' AND pid <> pg_backend_pid()`,
        )
        .catch(() => undefined);
      await admin
        .unsafe(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}"`)
        .catch(() => undefined);
      await admin.end({ timeout: 5 }).catch(() => undefined);
    }
  }, 30_000);

  beforeEach(async () => {
    await client.unsafe(`TRUNCATE TABLE "im_ahand_devices" RESTART IDENTITY`);
    await redis.flushdb();

    hub = makeHubStub();
    events = makeEventsStub();
    publisher = makePublisherStub();

    const moduleRef = await Test.createTestingModule({
      controllers: [AhandController, AhandHubWebhookController],
      providers: [
        AhandDevicesService,
        AhandWebhookService,
        { provide: AhandHubClient, useValue: hub },
        { provide: AhandRedisPublisher, useValue: publisher },
        { provide: AhandEventsGateway, useValue: events },
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    })
      .overrideGuard(AuthGuard)
      .useClass(TestAuthGuard)
      .compile();

    // Match main.ts: bodyParser disabled + custom json with rawBody verify
    // hook so the webhook controller can HMAC-verify the exact byte stream.
    app = moduleRef.createNestApplication({ bodyParser: false });
    app.use(
      json({
        limit: '10mb',
        verify: (req: unknown, _res, buf: Buffer) => {
          (req as { rawBody?: Buffer }).rawBody = buf;
        },
      }),
    );
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    await app.init();

    TestAuthGuard.allow = true;
    TestAuthGuard.sub = randomUUID();
  });

  afterEach(async () => {
    if (app) await app.close().catch(() => undefined);
  });

  // -------------------------------------------------------------------------
  // Scenario 1 — idempotent webhook
  // -------------------------------------------------------------------------
  describe('idempotent webhook delivery', () => {
    it('first POST fires presence + emit; second 204 with no side effects', async () => {
      const userId = TestAuthGuard.sub;
      const hubDeviceId = fakeHubDeviceId('idempotent-webhook');

      // Seed a device row so the webhook handler can resolve ownership and
      // exercise the fan-out path (a webhook for an unknown device would
      // short-circuit before emit).
      await db.insert(schema.ahandDevices).values({
        ownerType: 'user',
        ownerId: userId,
        hubDeviceId,
        publicKey: VALID_PUBLIC_KEY,
        nickname: 'idempotent-test',
        platform: 'macos',
        status: 'active',
      });

      const eventId = '01HJK0WEBHOOK0000000000000';
      const payload = {
        eventId,
        eventType: 'device.online' as const,
        occurredAt: new Date().toISOString(),
        deviceId: hubDeviceId,
        externalUserId: userId,
        data: { presenceTtlSeconds: 180 },
      };
      const raw = Buffer.from(JSON.stringify(payload), 'utf8');
      const { signature, timestamp } = signWebhook(raw);
      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

      // First delivery — should fire emit + presence. We send `raw` as a
      // utf-8 string (not a Buffer) so supertest pipes the exact bytes we
      // signed; passing a Buffer to .send() goes through superagent's
      // multipart heuristics and corrupts the body.
      const first = await request(httpServer)
        .post('/api/v1/ahand/hub-webhook')
        .set('Content-Type', 'application/json')
        .set('X-AHand-Signature', signature)
        .set('X-AHand-Timestamp', timestamp)
        .set('X-AHand-Event-Id', eventId)
        .send(raw.toString('utf8'));
      expect(first.status).toBe(204);

      const presenceFirst = await redis.get(devicePresenceKey(hubDeviceId));
      expect(presenceFirst).toBe('online');
      expect(events.emitToOwner).toHaveBeenCalledTimes(1);
      expect(events.emitToOwner).toHaveBeenCalledWith(
        'user',
        userId,
        'device.online',
        expect.objectContaining({ hubDeviceId }),
      );
      expect(await redis.get(webhookDedupeKey(eventId))).toBe('1');

      // Lower the TTL on the presence key so we can prove the duplicate
      // delivery did NOT re-`SET` it (a re-SET would refresh the TTL back
      // to ~180s).
      await redis.expire(devicePresenceKey(hubDeviceId), 5);
      const ttlBefore = await redis.ttl(devicePresenceKey(hubDeviceId));
      expect(ttlBefore).toBeLessThanOrEqual(5);

      events.emitToOwner.mockClear();

      // Second delivery — same eventId. Dedupe should swallow it.
      const second = await request(httpServer)
        .post('/api/v1/ahand/hub-webhook')
        .set('Content-Type', 'application/json')
        .set('X-AHand-Signature', signature)
        .set('X-AHand-Timestamp', timestamp)
        .set('X-AHand-Event-Id', eventId)
        .send(raw.toString('utf8'));
      expect(second.status).toBe(204);
      expect(events.emitToOwner).not.toHaveBeenCalled();

      const ttlAfter = await redis.ttl(devicePresenceKey(hubDeviceId));
      // TTL should not have been refreshed — still bounded by our manual 5s.
      expect(ttlAfter).toBeLessThanOrEqual(5);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 2 — ownership enforcement
  // -------------------------------------------------------------------------
  describe('ownership enforcement on /devices/:id/token/refresh', () => {
    it("returns 404 (not 403) when user A targets user B's device", async () => {
      const userA = randomUUID();
      const userB = randomUUID();

      // Insert user B's device. We capture the row id so user A can target
      // it directly — the 404 must come from ownership mismatch, not from
      // the id being unknown.
      const [bDevice] = await db
        .insert(schema.ahandDevices)
        .values({
          ownerType: 'user',
          ownerId: userB,
          hubDeviceId: fakeHubDeviceId('user-b-device'),
          publicKey: VALID_PUBLIC_KEY,
          nickname: 'user-b-device',
          platform: 'linux',
          status: 'active',
        })
        .returning();

      TestAuthGuard.sub = userA;

      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer).post(
        `/api/v1/ahand/devices/${bDevice.id}/token/refresh`,
      );

      // Service maps owner mismatch to NotFoundException to avoid leaking
      // existence of the foreign device id. 403 would be a regression —
      // see the comment on requireOwnedDevice() in ahand.service.ts.
      expect(res.status).toBe(404);
      // Hub must NOT have been touched — the 404 is short-circuited at the
      // ownership lookup, well before any token mint.
      expect(hub.mintDeviceToken).not.toHaveBeenCalled();

      // The row itself must remain untouched and readable to its owner.
      const stillThere = await db
        .select()
        .from(schema.ahandDevices)
        .where(eq(schema.ahandDevices.id, bDevice.id));
      expect(stillThere).toHaveLength(1);
      expect(stillThere[0].ownerId).toBe(userB);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 3 — concurrent register collision
  // -------------------------------------------------------------------------
  describe('concurrent register collision', () => {
    it('exactly one of N parallel registers wins; the rest get 409', async () => {
      const sharedHubDeviceId = fakeHubDeviceId('contended-device');
      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

      // 10 *different* users racing to claim the same hubDeviceId. Same-user
      // races would take the idempotent re-register branch and all succeed,
      // which wouldn't exercise the UNIQUE constraint we want to pin down.
      const userIds = Array.from({ length: 10 }, () => randomUUID());

      // Each request authenticates as a distinct user via X-Test-User-Sub
      // (TestAuthGuard reads it per-request). A static `sub` would race
      // across the 10 concurrent calls and break this test.
      const responses = await Promise.all(
        userIds.map((uid) =>
          request(httpServer)
            .post('/api/v1/ahand/devices')
            .set('X-Test-User-Sub', uid)
            .send({
              hubDeviceId: sharedHubDeviceId,
              publicKey: VALID_PUBLIC_KEY,
              nickname: `racer-${uid.slice(0, 6)}`,
              platform: 'macos',
            }),
        ),
      );

      const succeeded = responses.filter((r) => r.status === 201);
      const conflicts = responses.filter((r) => r.status === 409);
      // No 5xx allowed: every loser must be a clean 409.
      const others = responses.filter(
        (r) => r.status !== 201 && r.status !== 409,
      );
      expect(others.map((r) => ({ status: r.status, body: r.body }))).toEqual(
        [],
      );
      expect(succeeded).toHaveLength(1);
      expect(conflicts).toHaveLength(userIds.length - 1);

      // DB invariant: exactly one row exists for that hubDeviceId.
      const rows = await db
        .select()
        .from(schema.ahandDevices)
        .where(eq(schema.ahandDevices.hubDeviceId, sharedHubDeviceId));
      expect(rows).toHaveLength(1);
      expect(userIds).toContain(rows[0].ownerId);
    }, 20_000);
  });

  // -------------------------------------------------------------------------
  // Scenario 4 — Redis outage during /devices list
  // -------------------------------------------------------------------------
  describe('Redis outage during list', () => {
    it('returns rows with isOnline:null instead of 500 when mget throws', async () => {
      const userId = TestAuthGuard.sub;

      await db.insert(schema.ahandDevices).values({
        ownerType: 'user',
        ownerId: userId,
        hubDeviceId: fakeHubDeviceId('redis-outage-device'),
        publicKey: VALID_PUBLIC_KEY,
        nickname: 'redis-outage',
        platform: 'macos',
        status: 'active',
      });

      // Simulate the outage. We can't actually kill the test redis (other
      // suites in the worker process share the connection), so we forcibly
      // make the one call ahand uses for presence reads throw.
      const mgetSpy = jest
        .spyOn(redis, 'mget')
        .mockRejectedValueOnce(new Error('simulated Redis outage during mget'));

      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer).get('/api/v1/ahand/devices');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        nickname: 'redis-outage',
        isOnline: null,
      });
      expect(mgetSpy).toHaveBeenCalledTimes(1);

      // Verify that once Redis recovers, presence reads come back online.
      mgetSpy.mockRestore();
      const recovered = await request(httpServer).get('/api/v1/ahand/devices');
      expect(recovered.status).toBe(200);
      expect(recovered.body[0].isOnline).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 5 — hub 5xx during register → no orphaned DB row
  // -------------------------------------------------------------------------
  describe('hub 5xx during register', () => {
    it('leaves no DB row behind; retry after recovery succeeds', async () => {
      const userId = TestAuthGuard.sub;
      const hubDeviceId = fakeHubDeviceId('hub-5xx-device');
      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

      hub.registerDevice.mockRejectedValueOnce(
        new ServiceUnavailableException('hub: simulated 503'),
      );

      const failed = await request(httpServer)
        .post('/api/v1/ahand/devices')
        .send({
          hubDeviceId,
          publicKey: VALID_PUBLIC_KEY,
          nickname: 'transient-failure',
          platform: 'macos',
        });
      expect(failed.status).toBe(503);

      // No row visible — the service rolled back (i.e. never inserted) when
      // the hub call failed before the DB transaction.
      const orphans = await db
        .select()
        .from(schema.ahandDevices)
        .where(eq(schema.ahandDevices.hubDeviceId, hubDeviceId));
      expect(orphans).toHaveLength(0);

      // The mintDeviceToken stub must NOT have been called — the rollback
      // happened before reaching that step.
      expect(hub.mintDeviceToken).not.toHaveBeenCalled();

      // Retry now that the hub is healthy. The next call to registerDevice
      // resolves OK (default stub behaviour), so the full register flow
      // should land a row + JWT.
      const ok = await request(httpServer).post('/api/v1/ahand/devices').send({
        hubDeviceId,
        publicKey: VALID_PUBLIC_KEY,
        nickname: 'transient-failure',
        platform: 'macos',
      });
      expect(ok.status).toBe(201);
      expect(ok.body.device.hubDeviceId).toBe(hubDeviceId);

      const persisted = await db
        .select()
        .from(schema.ahandDevices)
        .where(eq(schema.ahandDevices.hubDeviceId, hubDeviceId));
      expect(persisted).toHaveLength(1);
      expect(persisted[0].ownerId).toBe(userId);
    });
  });
});

// Skip stub so a `--listTests` reader sees *why* nothing ran when Postgres /
// Redis aren't reachable, mirroring the wiki integration spec contract.
if (!REACHABLE) {
  describe('Ahand persistence (e2e — real Postgres + Redis)', () => {
    it.skip('skipped — Postgres or Redis unreachable on default ports', () => {
      // intentional no-op
    });
  });
}
