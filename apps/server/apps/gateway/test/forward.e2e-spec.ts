/**
 * HTTP-level integration tests for the forward endpoints.
 *
 * Scoped to "controller + guards + pipes" integration, not full e2e.
 * Persistence, Redis, RabbitMQ, and WebSocket broadcasting are NOT
 * exercised here — those scenarios belong to environments with the
 * necessary infra wired up (covered by Task 13's manual smoke step).
 *
 * What this spec pins:
 *  - Route URLs match the declared @Controller / @Post / @Get decorators.
 *  - AuthGuard runs before any handler logic.
 *  - ParseUUIDPipe rejects non-UUID path params with 400.
 *  - ValidationPipe enforces all DTO constraints (empty array, >100 ids,
 *    non-UUID sourceChannelId, non-UUID ids inside the array).
 *  - Successful calls delegate to ForwardsService with the expected shape.
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
import { ForwardsController } from '../src/im/messages/forwards/forwards.controller.js';
import { ForwardsService } from '../src/im/messages/forwards/forwards.service.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TARGET_CHANNEL = '019cd29d-4852-748f-ad39-dbc28410914e';
const SOURCE_CHANNEL = '019cd29d-5000-7000-a000-b00000000000';
const SOURCE_MSG = '019cd29d-6000-7000-a000-c00000000000';
const USER_ID = '019cd29d-7000-7000-a000-d00000000000';

// ---------------------------------------------------------------------------
// Test auth guard — mirrors the pattern used in ahand-integration.e2e-spec.ts
// ---------------------------------------------------------------------------

class TestAuthGuard implements CanActivate {
  static allow = true;
  static sub = USER_ID;

  canActivate(ctx: ExecutionContext): boolean {
    if (!TestAuthGuard.allow) {
      throw new UnauthorizedException('test guard: denied');
    }
    const req = ctx.switchToHttp().getRequest<{ user?: { sub: string } }>();
    req.user = { sub: TestAuthGuard.sub };
    return true;
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Forward HTTP (integration)', () => {
  let app: INestApplication;
  let svc: {
    forward: ReturnType<typeof jest.fn>;
    getForwardItems: ReturnType<typeof jest.fn>;
  };

  beforeEach(async () => {
    svc = {
      forward: jest.fn(),
      getForwardItems: jest.fn(),
    };

    TestAuthGuard.allow = true;
    TestAuthGuard.sub = USER_ID;

    const moduleRef = await Test.createTestingModule({
      controllers: [ForwardsController],
      providers: [{ provide: ForwardsService, useValue: svc }],
    })
      .overrideGuard(AuthGuard)
      .useClass(TestAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    // Mirror production bootstrap from apps/server/apps/gateway/src/main.ts:
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/im/channels/:targetChannelId/forward
  // -------------------------------------------------------------------------

  describe('POST /api/v1/im/channels/:targetChannelId/forward', () => {
    it('delegates to ForwardsService.forward on happy path and returns 201', async () => {
      const mockResponse = {
        id: SOURCE_MSG,
        type: 'forward',
        channelId: TARGET_CHANNEL,
        senderId: USER_ID,
        content: 'forwarded',
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      svc.forward.mockResolvedValueOnce(mockResponse);

      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer)
        .post(`/api/v1/im/channels/${TARGET_CHANNEL}/forward`)
        .send({
          sourceChannelId: SOURCE_CHANNEL,
          sourceMessageIds: [SOURCE_MSG],
          clientMsgId: 'cid-001',
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: SOURCE_MSG, type: 'forward' });
      expect(svc.forward).toHaveBeenCalledWith({
        targetChannelId: TARGET_CHANNEL,
        sourceChannelId: SOURCE_CHANNEL,
        sourceMessageIds: [SOURCE_MSG],
        clientMsgId: 'cid-001',
        userId: USER_ID,
      });
    });

    it('returns 201 without optional clientMsgId', async () => {
      svc.forward.mockResolvedValueOnce({
        id: SOURCE_MSG,
        type: 'forward',
      });

      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer)
        .post(`/api/v1/im/channels/${TARGET_CHANNEL}/forward`)
        .send({
          sourceChannelId: SOURCE_CHANNEL,
          sourceMessageIds: [SOURCE_MSG],
        });

      expect(res.status).toBe(201);
      expect(svc.forward).toHaveBeenCalledWith(
        expect.objectContaining({
          targetChannelId: TARGET_CHANNEL,
          userId: USER_ID,
          clientMsgId: undefined,
        }),
      );
    });

    it('returns 400 for non-UUID targetChannelId (ParseUUIDPipe)', async () => {
      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer)
        .post('/api/v1/im/channels/not-a-uuid/forward')
        .send({
          sourceChannelId: SOURCE_CHANNEL,
          sourceMessageIds: [SOURCE_MSG],
        });

      expect(res.status).toBe(400);
      expect(svc.forward).not.toHaveBeenCalled();
    });

    it('returns 400 with forward.empty message for empty sourceMessageIds', async () => {
      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer)
        .post(`/api/v1/im/channels/${TARGET_CHANNEL}/forward`)
        .send({
          sourceChannelId: SOURCE_CHANNEL,
          sourceMessageIds: [],
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('forward.empty');
      expect(svc.forward).not.toHaveBeenCalled();
    });

    it('returns 400 with forward.tooManySelected when sourceMessageIds.length > 100', async () => {
      const ids = Array.from({ length: 101 }, () => SOURCE_MSG);
      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer)
        .post(`/api/v1/im/channels/${TARGET_CHANNEL}/forward`)
        .send({
          sourceChannelId: SOURCE_CHANNEL,
          sourceMessageIds: ids,
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('forward.tooManySelected');
      expect(svc.forward).not.toHaveBeenCalled();
    });

    it('returns 400 for non-UUID sourceChannelId in body', async () => {
      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer)
        .post(`/api/v1/im/channels/${TARGET_CHANNEL}/forward`)
        .send({
          sourceChannelId: 'not-a-uuid',
          sourceMessageIds: [SOURCE_MSG],
        });

      expect(res.status).toBe(400);
      expect(svc.forward).not.toHaveBeenCalled();
    });

    it('returns 400 for non-UUID id inside sourceMessageIds', async () => {
      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer)
        .post(`/api/v1/im/channels/${TARGET_CHANNEL}/forward`)
        .send({
          sourceChannelId: SOURCE_CHANNEL,
          sourceMessageIds: ['nope-not-a-uuid'],
        });

      expect(res.status).toBe(400);
      expect(svc.forward).not.toHaveBeenCalled();
    });

    it('returns 400 when sourceChannelId is missing', async () => {
      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer)
        .post(`/api/v1/im/channels/${TARGET_CHANNEL}/forward`)
        .send({
          sourceMessageIds: [SOURCE_MSG],
        });

      expect(res.status).toBe(400);
      expect(svc.forward).not.toHaveBeenCalled();
    });

    it('returns 400 when sourceMessageIds is missing', async () => {
      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer)
        .post(`/api/v1/im/channels/${TARGET_CHANNEL}/forward`)
        .send({
          sourceChannelId: SOURCE_CHANNEL,
        });

      expect(res.status).toBe(400);
      expect(svc.forward).not.toHaveBeenCalled();
    });

    it('returns 401 when auth guard denies', async () => {
      TestAuthGuard.allow = false;

      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer)
        .post(`/api/v1/im/channels/${TARGET_CHANNEL}/forward`)
        .send({
          sourceChannelId: SOURCE_CHANNEL,
          sourceMessageIds: [SOURCE_MSG],
        });

      expect(res.status).toBe(401);
      expect(svc.forward).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/im/messages/:id/forward-items
  // -------------------------------------------------------------------------

  describe('GET /api/v1/im/messages/:id/forward-items', () => {
    it('delegates to ForwardsService.getForwardItems and returns 200 with items', async () => {
      const mockItems = [
        {
          position: 0,
          sourceMessageId: SOURCE_MSG,
          sourceChannelId: SOURCE_CHANNEL,
          sourceChannelName: 'general',
          sourceWorkspaceId: null,
          sourceSender: null,
          sourceCreatedAt: '2026-01-01T00:00:00.000Z',
          sourceSeqId: null,
          sourceType: 'text',
          contentSnapshot: 'hello',
          contentAstSnapshot: null,
          attachmentsSnapshot: [],
          canJumpToOriginal: true,
          truncated: false,
        },
      ];
      svc.getForwardItems.mockResolvedValueOnce(mockItems);

      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer).get(
        `/api/v1/im/messages/${SOURCE_MSG}/forward-items`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockItems);
      expect(svc.getForwardItems).toHaveBeenCalledWith(SOURCE_MSG, USER_ID);
    });

    it('returns 200 with empty array when no items', async () => {
      svc.getForwardItems.mockResolvedValueOnce([]);

      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer).get(
        `/api/v1/im/messages/${SOURCE_MSG}/forward-items`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns 400 for non-UUID message id (ParseUUIDPipe)', async () => {
      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer).get(
        '/api/v1/im/messages/not-a-uuid/forward-items',
      );

      expect(res.status).toBe(400);
      expect(svc.getForwardItems).not.toHaveBeenCalled();
    });

    it('returns 401 when auth guard denies on GET', async () => {
      TestAuthGuard.allow = false;

      const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(httpServer).get(
        `/api/v1/im/messages/${SOURCE_MSG}/forward-items`,
      );

      expect(res.status).toBe(401);
      expect(svc.getForwardItems).not.toHaveBeenCalled();
    });
  });
});
