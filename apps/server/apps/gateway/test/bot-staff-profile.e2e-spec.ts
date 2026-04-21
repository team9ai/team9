import {
  jest,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
} from '@jest/globals';
import {
  INestApplication,
  ValidationPipe,
  ExecutionContext,
  CanActivate,
  UnauthorizedException,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from '@team9/auth';
import { BotStaffProfileController } from '../src/bot/staff-profile/bot-staff-profile.controller.js';
import { BotStaffProfileService } from '../src/bot/staff-profile/bot-staff-profile.service.js';
import type { StaffProfileSnapshot } from '../src/bot/staff-profile/bot-staff-profile.service.js';

/**
 * Controllable test guard — static flags let each test configure auth inline
 * without re-creating the app.
 */
class TestAuthGuard implements CanActivate {
  static allow = true;
  static sub = 'bot-1';

  canActivate(ctx: ExecutionContext): boolean {
    if (!TestAuthGuard.allow) {
      // Throwing UnauthorizedException produces a 401 response from Nest.
      throw new UnauthorizedException('test guard: denied');
    }
    const req = ctx.switchToHttp().getRequest<{ user?: { sub: string } }>();
    req.user = { sub: TestAuthGuard.sub };
    return true;
  }
}

const FIXTURE_SNAPSHOT: StaffProfileSnapshot = {
  agentId: 'agent-abc',
  botUserId: 'bot-1',
  identity: { name: 'Alice' },
  role: { title: 'Support Agent', description: 'Handles customer queries' },
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('BotStaffProfile HTTP (e2e)', () => {
  let app: INestApplication;
  let service: {
    getSnapshot: ReturnType<typeof jest.fn>;
    updateSnapshot: ReturnType<typeof jest.fn>;
  };

  beforeEach(async () => {
    service = {
      getSnapshot: jest.fn(),
      updateSnapshot: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [BotStaffProfileController],
      providers: [{ provide: BotStaffProfileService, useValue: service }],
    })
      .overrideGuard(AuthGuard)
      .useClass(TestAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();

    // Match main.ts exactly: whitelist: true only (no forbidNonWhitelisted in main.ts)
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );

    // Match main.ts: global prefix 'api'
    app.setGlobalPrefix('api');

    // Match main.ts: URI versioning with defaultVersion '1'
    // Note: main.ts uses defaultVersion instead of prefix, so the path is
    // /api/v1/bot/staff/profile when the version is declared on the controller.
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });

    await app.init();

    // Reset static guard flags before each test so order doesn't matter.
    TestAuthGuard.allow = true;
    TestAuthGuard.sub = 'bot-1';
  });

  afterEach(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/bot/staff/profile
  // ---------------------------------------------------------------------------

  it('GET returns 200 + snapshot when header matches authenticated sub', async () => {
    service.getSnapshot.mockResolvedValue(FIXTURE_SNAPSHOT);

    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(httpServer)
      .get('/api/v1/bot/staff/profile')
      .set('X-Team9-Bot-User-Id', 'bot-1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(FIXTURE_SNAPSHOT);
    // The controller must call service with the JWT sub, not the raw header value.
    expect(service.getSnapshot).toHaveBeenCalledWith('bot-1');
    expect(service.getSnapshot).toHaveBeenCalledTimes(1);
  });

  it('GET returns 401 when guard rejects', async () => {
    // TestAuthGuard throws UnauthorizedException → Nest maps it to 401.
    // (If the guard returned `false` without throwing, Nest would produce 403 ForbiddenException.)
    TestAuthGuard.allow = false;

    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(httpServer).get('/api/v1/bot/staff/profile');

    expect(res.status).toBe(401);
    expect(service.getSnapshot).not.toHaveBeenCalled();
  });

  it('GET returns 403 when X-Team9-Bot-User-Id header is missing', async () => {
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(httpServer).get('/api/v1/bot/staff/profile');
    // No header → assertHeaderMatches throws ForbiddenException.
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      message: 'X-Team9-Bot-User-Id does not match authenticated bot',
    });
    expect(service.getSnapshot).not.toHaveBeenCalled();
  });

  it('GET returns 403 when X-Team9-Bot-User-Id header mismatches authenticated sub', async () => {
    // Guard says sub='bot-1', but header says 'bot-2'.
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(httpServer)
      .get('/api/v1/bot/staff/profile')
      .set('X-Team9-Bot-User-Id', 'bot-2');

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      message: 'X-Team9-Bot-User-Id does not match authenticated bot',
    });
    expect(service.getSnapshot).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/v1/bot/staff/profile
  // ---------------------------------------------------------------------------

  it('PATCH returns 200 + updated snapshot when header matches and body is valid', async () => {
    service.updateSnapshot.mockResolvedValue(FIXTURE_SNAPSHOT);

    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(httpServer)
      .patch('/api/v1/bot/staff/profile')
      .set('X-Team9-Bot-User-Id', 'bot-1')
      .send({ persona: { mode: 'append', content: 'Hi' } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(FIXTURE_SNAPSHOT);
    expect(service.updateSnapshot).toHaveBeenCalledWith('bot-1', {
      identityPatch: undefined,
      role: undefined,
      persona: { mode: 'append', content: 'Hi' },
    });
    expect(service.updateSnapshot).toHaveBeenCalledTimes(1);
  });

  it('PATCH returns 400 when body is empty object', async () => {
    // DTO _atLeastOne guard fires when all three optional fields are absent.
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(httpServer)
      .patch('/api/v1/bot/staff/profile')
      .set('X-Team9-Bot-User-Id', 'bot-1')
      .send({});

    expect(res.status).toBe(400);
    expect(service.updateSnapshot).not.toHaveBeenCalled();
  });

  it('PATCH returns 400 when persona.mode is an invalid enum value', async () => {
    // 'overwrite' is not in the ['append','replace'] IsIn list.
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(httpServer)
      .patch('/api/v1/bot/staff/profile')
      .set('X-Team9-Bot-User-Id', 'bot-1')
      .send({ persona: { mode: 'overwrite', content: 'x' } });

    expect(res.status).toBe(400);
    expect(service.updateSnapshot).not.toHaveBeenCalled();
  });

  it('PATCH returns 400 when role.title is an empty string', async () => {
    // MinLength(1) on RolePatchDto.title rejects an empty string.
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(httpServer)
      .patch('/api/v1/bot/staff/profile')
      .set('X-Team9-Bot-User-Id', 'bot-1')
      .send({ role: { title: '' } });

    expect(res.status).toBe(400);
    expect(service.updateSnapshot).not.toHaveBeenCalled();
  });

  it('PATCH returns 403 when X-Team9-Bot-User-Id header is missing', async () => {
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(httpServer)
      .patch('/api/v1/bot/staff/profile')
      .send({ persona: { mode: 'replace', content: 'Hello' } });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      message: 'X-Team9-Bot-User-Id does not match authenticated bot',
    });
    expect(service.updateSnapshot).not.toHaveBeenCalled();
  });

  it('GET returns 200 with mixed-case X-Team9-Bot-User-Id header (case-insensitive)', async () => {
    // HTTP/1.1 headers are case-insensitive; Node/Express normalises them to
    // lowercase before NestJS reads them.  @Headers('x-team9-bot-user-id')
    // therefore works regardless of how the sender capitalises the header.
    service.getSnapshot.mockResolvedValue(FIXTURE_SNAPSHOT);

    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(httpServer)
      .get('/api/v1/bot/staff/profile')
      // Mixed capitalisation — the raw header name from the client.
      .set('x-TEAM9-bot-USER-id', 'bot-1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(FIXTURE_SNAPSHOT);
  });
});
