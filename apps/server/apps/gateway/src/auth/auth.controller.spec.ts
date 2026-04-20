import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthGuard } from '@team9/auth';

// ── helpers ──────────────────────────────────────────────────────────

function mockAuthService() {
  return {
    authStart: jest.fn<any>(),
    verifyCode: jest.fn<any>(),
    createDesktopSession: jest.fn<any>(),
    completeDesktopSession: jest.fn<any>(),
    register: jest.fn<any>(),
    login: jest.fn<any>(),
    verifyEmail: jest.fn<any>(),
    pollLogin: jest.fn<any>(),
    googleLogin: jest.fn<any>(),
    resendVerificationEmail: jest.fn<any>(),
    refreshToken: jest.fn<any>(),
    logout: jest.fn<any>(),
    getUserById: jest.fn<any>(),
    getUserByClaims: jest.fn<any>(),
  };
}

describe('AuthController (integration)', () => {
  let app: INestApplication;
  let authService: ReturnType<typeof mockAuthService>;

  beforeEach(async () => {
    authService = mockAuthService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    })
      // Override the AuthGuard to simulate authenticated user
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = {
            sub: 'user-uuid',
            email: 'alice@test.com',
            username: 'alice',
          };
          return true;
        },
      })
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── POST /auth/start ──────────────────────────────────────────────

  describe('POST /api/v1/auth/start', () => {
    it('should return 200 with valid email', async () => {
      authService.authStart.mockResolvedValue({
        action: 'code_sent',
        email: 'alice@test.com',
        challengeId: 'ch-1',
        expiresInSeconds: 600,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/start')
        .send({ email: 'alice@test.com' })
        .expect(200);

      expect(res.body.action).toBe('code_sent');
      expect(authService.authStart).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'alice@test.com',
        }),
        expect.any(String),
      );
    });

    it('should accept optional displayName', async () => {
      authService.authStart.mockResolvedValue({
        action: 'code_sent',
        email: 'new@test.com',
        challengeId: 'ch-2',
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/start')
        .send({ email: 'new@test.com', displayName: 'New User' })
        .expect(200);

      expect(authService.authStart).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@test.com',
          displayName: 'New User',
        }),
        expect.any(String),
      );
    });

    it('should reject invalid email with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/start')
        .send({ email: 'not-an-email' })
        .expect(400);

      expect(authService.authStart).not.toHaveBeenCalled();
    });

    it('should reject missing email with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/start')
        .send({})
        .expect(400);

      expect(authService.authStart).not.toHaveBeenCalled();
    });

    it('should strip unknown fields (whitelist)', async () => {
      authService.authStart.mockResolvedValue({
        action: 'need_display_name',
        email: 'alice@test.com',
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/start')
        .send({ email: 'alice@test.com', malicious: 'payload' })
        .expect(200);

      expect(authService.authStart).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'alice@test.com',
        }),
        expect.any(String),
      );
    });
  });

  // ── POST /auth/verify-code ────────────────────────────────────────

  describe('POST /api/v1/auth/verify-code', () => {
    const validBody = {
      email: 'alice@test.com',
      challengeId: 'ch-1',
      code: '123456',
    };

    it('should return 200 with valid payload', async () => {
      authService.verifyCode.mockResolvedValue({
        accessToken: 'at',
        refreshToken: 'rt',
        user: { id: 'u1', email: 'alice@test.com' },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-code')
        .send(validBody)
        .expect(200);

      expect(res.body.accessToken).toBe('at');
    });

    it('should reject missing challengeId with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-code')
        .send({ email: 'alice@test.com', code: '123456' })
        .expect(400);

      expect(authService.verifyCode).not.toHaveBeenCalled();
    });

    it('should reject missing code with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-code')
        .send({ email: 'alice@test.com', challengeId: 'ch-1' })
        .expect(400);

      expect(authService.verifyCode).not.toHaveBeenCalled();
    });

    it('should reject empty code string with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-code')
        .send({ email: 'alice@test.com', challengeId: 'ch-1', code: '' })
        .expect(400);

      expect(authService.verifyCode).not.toHaveBeenCalled();
    });

    it('should reject invalid email with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-code')
        .send({ email: 'bad', challengeId: 'ch-1', code: '123456' })
        .expect(400);
    });
  });

  // ── POST /auth/create-desktop-session ─────────────────────────────

  describe('POST /api/v1/auth/create-desktop-session', () => {
    it('should return 201 with session data', async () => {
      authService.createDesktopSession.mockResolvedValue({
        sessionId: 's-1',
        expiresInSeconds: 1800,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/create-desktop-session')
        .expect(201);

      expect(res.body.sessionId).toBe('s-1');
      expect(res.body.expiresInSeconds).toBe(1800);
      // Should pass IP to service
      expect(authService.createDesktopSession).toHaveBeenCalledWith(
        expect.any(String),
      );
    });
  });

  // ── POST /auth/complete-desktop-session ───────────────────────────

  describe('POST /api/v1/auth/complete-desktop-session', () => {
    it('should return 200 with valid payload (requires auth)', async () => {
      authService.completeDesktopSession.mockResolvedValue({ success: true });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/complete-desktop-session')
        .send({ sessionId: 's-1' })
        .expect(200);

      expect(res.body.success).toBe(true);
      // Should pass userId from JWT
      expect(authService.completeDesktopSession).toHaveBeenCalledWith(
        { sessionId: 's-1' },
        'user-uuid',
      );
    });

    it('should reject missing sessionId with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/complete-desktop-session')
        .send({})
        .expect(400);

      expect(authService.completeDesktopSession).not.toHaveBeenCalled();
    });

    it('should reject empty sessionId with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/complete-desktop-session')
        .send({ sessionId: '' })
        .expect(400);

      expect(authService.completeDesktopSession).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should pass optional refreshToken to service', async () => {
      authService.logout.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({ refreshToken: 'rt-1' })
        .expect(200);

      expect(res.body).toEqual({ success: true });
      expect(authService.logout).toHaveBeenCalledWith('user-uuid', 'rt-1');
    });

    it('should allow empty body', async () => {
      authService.logout.mockResolvedValue(undefined);

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({})
        .expect(200);

      expect(authService.logout).toHaveBeenCalledWith('user-uuid', undefined);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('falls back to token identity when sub no longer resolves', async () => {
      authService.getUserById.mockRejectedValueOnce(
        new UnauthorizedException('User not found'),
      );
      authService.getUserByClaims.mockResolvedValueOnce({
        id: 'new-user-uuid',
        email: 'alice@test.com',
        username: 'alice',
        displayName: 'Alice',
        avatarUrl: undefined,
        isActive: true,
        createdAt: '2026-04-03T00:00:00.000Z',
        updatedAt: '2026-04-03T00:00:00.000Z',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .expect(200);

      expect(res.body).toEqual({
        id: 'new-user-uuid',
        email: 'alice@test.com',
        username: 'alice',
        displayName: 'Alice',
        isActive: true,
        createdAt: '2026-04-03T00:00:00.000Z',
        updatedAt: '2026-04-03T00:00:00.000Z',
      });
      expect(authService.getUserById).toHaveBeenCalledWith('user-uuid');
      expect(authService.getUserByClaims).toHaveBeenCalledWith({
        email: 'alice@test.com',
        username: 'alice',
      });
    });
  });
});
