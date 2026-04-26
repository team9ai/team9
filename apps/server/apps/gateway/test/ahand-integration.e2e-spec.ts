/**
 * HTTP-level integration tests for the ahand gateway endpoints.
 *
 * Scoped to wire-contract regressions we hit in the last 24h:
 * - InternalAuthGuard requires `Authorization: Bearer <token>` (PR #92);
 *   the legacy `X-Internal-Service-Token` header must NOT pass.
 * - DTOs accept UUIDv7 user ids (8e02f637) — non-UUID inputs reject at
 *   ValidationPipe before reaching the service.
 * - URL versioning + global `api` prefix match the canonical layout
 *   so claw-hive-worker's hardcoded paths keep working.
 *
 * Persistence + Redis are mocked via service stubs; this is "controller
 * + guards + pipes" integration, not full e2e. The cross-process
 * scenarios (DB concurrency, Redis outage, hub 5xx rollback) are
 * covered separately at the service-unit layer.
 */

import {
  beforeEach,
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
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from '@team9/auth';
import { AhandController } from '../src/ahand/ahand.controller.js';
import { AhandInternalController } from '../src/ahand/ahand-internal.controller.js';
import { AhandDevicesService } from '../src/ahand/ahand.service.js';

const INTERNAL_TOKEN =
  'a4dacd1312758259057900c323a28c646acab24d8f9c00a8577da087cbd96629';
const TEAM9_USER_ID_V7 = '019cd29d-4852-748f-ad39-dbc28410914e';
const VALID_DEVICE_ID =
  'ae0e2149d63db3b8e1772030215520915dbe460b38c461bc06659ba8c5f14e1e';
const VALID_PUBLIC_KEY = 'YgyIdtmO0d6U74kGLifLI63M/tvitTJK7HAXQuJY9IU=';

class TestAuthGuard implements CanActivate {
  static allow = true;
  static sub = TEAM9_USER_ID_V7;

  canActivate(ctx: ExecutionContext): boolean {
    if (!TestAuthGuard.allow) {
      throw new UnauthorizedException('test guard: denied');
    }
    const req = ctx.switchToHttp().getRequest<{ user?: { sub: string } }>();
    req.user = { sub: TestAuthGuard.sub };
    return true;
  }
}

describe('Ahand HTTP (integration)', () => {
  let app: INestApplication;
  let svc: {
    registerDeviceForUser: ReturnType<typeof jest.fn>;
    listActiveDevicesForUser: ReturnType<typeof jest.fn>;
    refreshDeviceToken: ReturnType<typeof jest.fn>;
    patchDevice: ReturnType<typeof jest.fn>;
    revokeDevice: ReturnType<typeof jest.fn>;
    mintControlPlaneTokenForUser: ReturnType<typeof jest.fn>;
  };

  beforeEach(async () => {
    // InternalAuthGuard reads INTERNAL_AUTH_VALIDATION_TOKEN from `env`
    // at constructor time. Set the env BEFORE compiling so the guard
    // captures the same value supertest sends.
    process.env.INTERNAL_AUTH_VALIDATION_TOKEN = INTERNAL_TOKEN;

    svc = {
      registerDeviceForUser: jest.fn(),
      listActiveDevicesForUser: jest.fn(),
      refreshDeviceToken: jest.fn(),
      patchDevice: jest.fn(),
      revokeDevice: jest.fn(),
      mintControlPlaneTokenForUser: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AhandController, AhandInternalController],
      providers: [{ provide: AhandDevicesService, useValue: svc }],
    })
      .overrideGuard(AuthGuard)
      .useClass(TestAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    await app.init();

    TestAuthGuard.allow = true;
    TestAuthGuard.sub = TEAM9_USER_ID_V7;
  });

  afterEach(async () => {
    await app.close();
  });

  // --------------------------------------------------------------------------
  // POST /api/v1/ahand/devices  (user-facing, JWT auth)
  // --------------------------------------------------------------------------

  describe('POST /api/v1/ahand/devices (register)', () => {
    it('returns 201 + device + JWT when JWT auth passes', async () => {
      const fixtureRow = {
        id: 'row-uuid',
        hubDeviceId: VALID_DEVICE_ID,
        publicKey: VALID_PUBLIC_KEY,
        nickname: 'macos-device',
        platform: 'macos',
        hostname: null,
        status: 'active',
        lastSeenAt: null,
        createdAt: new Date('2026-04-25T15:58:12.215Z'),
      };
      svc.registerDeviceForUser.mockResolvedValue({
        device: fixtureRow,
        deviceJwt: 'jwt-token',
        hubUrl: 'https://hub.test',
        jwtExpiresAt: '2026-04-26T15:58:12.215Z',
      });

      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer).post('/api/v1/ahand/devices').send({
        hubDeviceId: VALID_DEVICE_ID,
        publicKey: VALID_PUBLIC_KEY,
        nickname: 'macos-device',
        platform: 'macos',
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        device: {
          id: 'row-uuid',
          hubDeviceId: VALID_DEVICE_ID,
          isOnline: false,
        },
        deviceJwt: 'jwt-token',
        hubUrl: 'https://hub.test',
      });
      expect(svc.registerDeviceForUser).toHaveBeenCalledWith(
        TEAM9_USER_ID_V7,
        expect.objectContaining({ hubDeviceId: VALID_DEVICE_ID }),
      );
    });

    it('returns 401 when AuthGuard rejects', async () => {
      TestAuthGuard.allow = false;
      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer).post('/api/v1/ahand/devices').send({
        hubDeviceId: VALID_DEVICE_ID,
        publicKey: VALID_PUBLIC_KEY,
        nickname: 'macos-device',
        platform: 'macos',
      });

      expect(res.status).toBe(401);
      expect(svc.registerDeviceForUser).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/ahand/devices (list)', () => {
    it('returns 200 + device list scoped to the authenticated user', async () => {
      svc.listActiveDevicesForUser.mockResolvedValue([
        {
          id: 'row-uuid',
          hubDeviceId: VALID_DEVICE_ID,
          publicKey: VALID_PUBLIC_KEY,
          nickname: 'macos-device',
          platform: 'macos',
          hostname: null,
          status: 'active',
          isOnline: true,
          lastSeenAt: new Date('2026-04-26T05:14:12.193Z'),
          createdAt: new Date('2026-04-25T15:58:12.215Z'),
        },
      ]);

      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer).get('/api/v1/ahand/devices');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        hubDeviceId: VALID_DEVICE_ID,
        isOnline: true,
      });
      // includeOffline defaults to true; service stub still gets called.
      expect(svc.listActiveDevicesForUser).toHaveBeenCalledWith(
        TEAM9_USER_ID_V7,
        { includeOffline: true },
      );
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/v1/internal/ahand/devices/list-for-user  (im-worker only)
  //
  // Wire contract pinning: the gateway's InternalAuthGuard accepts ONLY
  // `Authorization: Bearer <token>`. The legacy `X-Internal-Service-Token`
  // header must keep being rejected so we never silently re-introduce it.
  // --------------------------------------------------------------------------

  describe('POST /api/v1/internal/ahand/devices/list-for-user (internal)', () => {
    it('returns 200 with Authorization: Bearer <correct token> + UUIDv7 userId', async () => {
      svc.listActiveDevicesForUser.mockResolvedValue([
        {
          id: 'row-uuid',
          hubDeviceId: VALID_DEVICE_ID,
          publicKey: VALID_PUBLIC_KEY,
          nickname: 'macos-device',
          platform: 'macos',
          hostname: null,
          status: 'active',
          isOnline: true,
          lastSeenAt: new Date('2026-04-26T05:14:12.193Z'),
          createdAt: new Date('2026-04-25T15:58:12.215Z'),
        },
      ]);

      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer)
        .post('/api/v1/internal/ahand/devices/list-for-user')
        .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
        .send({ userId: TEAM9_USER_ID_V7, includeOffline: true });

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        hubDeviceId: VALID_DEVICE_ID,
        isOnline: true,
      });
    });

    it('rejects the legacy X-Internal-Service-Token header with 401', async () => {
      // Regression: PR #92 switched the client from this header to
      // Bearer. If we ever accept it again on the server side we'd
      // mask the same kind of contract drift that left run_command
      // returning "Unauthorized" for an entire afternoon.
      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer)
        .post('/api/v1/internal/ahand/devices/list-for-user')
        .set('X-Internal-Service-Token', INTERNAL_TOKEN)
        .send({ userId: TEAM9_USER_ID_V7 });

      expect(res.status).toBe(401);
      expect(svc.listActiveDevicesForUser).not.toHaveBeenCalled();
    });

    it('rejects a wrong Bearer token with 401', async () => {
      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer)
        .post('/api/v1/internal/ahand/devices/list-for-user')
        .set('Authorization', 'Bearer not-the-token')
        .send({ userId: TEAM9_USER_ID_V7 });

      expect(res.status).toBe(401);
    });

    it('rejects a missing Authorization header with 401', async () => {
      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer)
        .post('/api/v1/internal/ahand/devices/list-for-user')
        .send({ userId: TEAM9_USER_ID_V7 });

      expect(res.status).toBe(401);
    });

    it('rejects a non-UUID userId with 400 even with valid auth', async () => {
      // Regression: pre-8e02f637 the DTO was @IsUUID('4') and rejected
      // the team9 UUIDv7 with this error. Keeping the test here makes
      // sure the v4 filter doesn't sneak back in.
      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer)
        .post('/api/v1/internal/ahand/devices/list-for-user')
        .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
        .send({ userId: 'auto' }); // hive-runtime sentinel — should never reach gateway

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/userId must be a UUID/);
      expect(svc.listActiveDevicesForUser).not.toHaveBeenCalled();
    });

    it('accepts UUIDv7 userId end-to-end (the 8e02f637 fix)', async () => {
      svc.listActiveDevicesForUser.mockResolvedValue([]);

      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer)
        .post('/api/v1/internal/ahand/devices/list-for-user')
        .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
        .send({ userId: TEAM9_USER_ID_V7 });

      expect(res.status).toBe(200);
      expect(svc.listActiveDevicesForUser).toHaveBeenCalledWith(
        TEAM9_USER_ID_V7,
        { includeOffline: true },
      );
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/v1/internal/ahand/control-plane/token  (im-worker only)
  // --------------------------------------------------------------------------

  describe('POST /api/v1/internal/ahand/control-plane/token (internal)', () => {
    it('returns 200 with Bearer auth + valid body', async () => {
      svc.mintControlPlaneTokenForUser.mockResolvedValue({
        token: 'cp-token',
        expiresAt: '2026-04-26T16:00:00.000Z',
      });

      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer)
        .post('/api/v1/internal/ahand/control-plane/token')
        .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
        .send({ userId: TEAM9_USER_ID_V7, deviceIds: [VALID_DEVICE_ID] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        token: 'cp-token',
        expiresAt: '2026-04-26T16:00:00.000Z',
      });
    });

    it('rejects oversized deviceIds array with 400', async () => {
      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer)
        .post('/api/v1/internal/ahand/control-plane/token')
        .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
        .send({
          userId: TEAM9_USER_ID_V7,
          deviceIds: Array(101).fill(VALID_DEVICE_ID),
        });

      expect(res.status).toBe(400);
    });
  });
});
