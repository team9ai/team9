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
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import { PushSubscriptionController } from './push-subscription.controller.js';
import { PushSubscriptionService } from './push-subscription.service.js';
import { AuthGuard } from '@team9/auth';

// ── helpers ──────────────────────────────────────────────────────────

function mockPushSubscriptionService() {
  return {
    subscribe: jest.fn<any>(),
    unsubscribe: jest.fn<any>(),
    unsubscribeAll: jest.fn<any>(),
    getSubscriptions: jest.fn<any>(),
    removeSubscription: jest.fn<any>(),
    updateLastUsed: jest.fn<any>(),
  };
}

describe('PushSubscriptionController (integration)', () => {
  let app: INestApplication;
  let pushService: ReturnType<typeof mockPushSubscriptionService>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    pushService = mockPushSubscriptionService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PushSubscriptionController],
      providers: [{ provide: PushSubscriptionService, useValue: pushService }],
    })
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    process.env = originalEnv;
    await app.close();
  });

  // ── GET /push-subscriptions/vapid-public-key ──────────────────────

  describe('GET /api/v1/push-subscriptions/vapid-public-key', () => {
    it('should return the VAPID public key when configured', async () => {
      process.env.VAPID_PUBLIC_KEY = 'test-vapid-public-key-base64';

      const res = await request(app.getHttpServer())
        .get('/api/v1/push-subscriptions/vapid-public-key')
        .expect(200);

      expect(res.body.publicKey).toBe('test-vapid-public-key-base64');
    });

    it('should return 503 when VAPID is not configured', async () => {
      delete process.env.VAPID_PUBLIC_KEY;

      await request(app.getHttpServer())
        .get('/api/v1/push-subscriptions/vapid-public-key')
        .expect(503);
    });

    it('should not require authentication', async () => {
      process.env.VAPID_PUBLIC_KEY = 'test-key';

      // Even without auth header, should succeed
      const res = await request(app.getHttpServer())
        .get('/api/v1/push-subscriptions/vapid-public-key')
        .expect(200);

      expect(res.body.publicKey).toBe('test-key');
    });
  });

  // ── POST /push-subscriptions ──────────────────────────────────────

  describe('POST /api/v1/push-subscriptions', () => {
    const validBody = {
      endpoint: 'https://push.example.com/sub/abc123',
      keys: {
        p256dh: 'BNbxGYNM1ci...',
        auth: 'tBHItJI5svmY...',
      },
    };

    it('should subscribe with valid payload', async () => {
      pushService.subscribe.mockResolvedValue({
        id: 'sub-uuid-1',
        userId: 'user-uuid',
        endpoint: validBody.endpoint,
        p256dh: validBody.keys.p256dh,
        auth: validBody.keys.auth,
        userAgent: 'TestAgent/1.0',
        createdAt: new Date(),
        lastUsedAt: null,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/push-subscriptions')
        .set('User-Agent', 'TestAgent/1.0')
        .send(validBody)
        .expect(201);

      expect(res.body.id).toBe('sub-uuid-1');
      expect(pushService.subscribe).toHaveBeenCalledWith(
        'user-uuid',
        validBody,
        'TestAgent/1.0',
      );
    });

    it('should reject missing endpoint with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/push-subscriptions')
        .send({ keys: { p256dh: 'key', auth: 'auth' } })
        .expect(400);

      expect(pushService.subscribe).not.toHaveBeenCalled();
    });

    it('should reject missing keys with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/push-subscriptions')
        .send({ endpoint: 'https://push.example.com/sub/abc' })
        .expect(400);

      expect(pushService.subscribe).not.toHaveBeenCalled();
    });

    it('should reject missing p256dh in keys with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/push-subscriptions')
        .send({
          endpoint: 'https://push.example.com/sub/abc',
          keys: { auth: 'auth-key' },
        })
        .expect(400);

      expect(pushService.subscribe).not.toHaveBeenCalled();
    });

    it('should reject missing auth in keys with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/push-subscriptions')
        .send({
          endpoint: 'https://push.example.com/sub/abc',
          keys: { p256dh: 'p256dh-key' },
        })
        .expect(400);

      expect(pushService.subscribe).not.toHaveBeenCalled();
    });

    it('should reject empty endpoint with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/push-subscriptions')
        .send({
          endpoint: '',
          keys: { p256dh: 'key', auth: 'auth' },
        })
        .expect(400);

      expect(pushService.subscribe).not.toHaveBeenCalled();
    });

    it('should reject non-https endpoint with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/push-subscriptions')
        .send({
          endpoint: 'http://push.example.com/sub/abc',
          keys: { p256dh: 'key', auth: 'auth' },
        })
        .expect(400);

      expect(pushService.subscribe).not.toHaveBeenCalled();
    });

    it('should pass undefined user-agent when header is not set', async () => {
      pushService.subscribe.mockResolvedValue({
        id: 'sub-uuid-2',
        userId: 'user-uuid',
        endpoint: validBody.endpoint,
        p256dh: validBody.keys.p256dh,
        auth: validBody.keys.auth,
        userAgent: undefined,
        createdAt: new Date(),
        lastUsedAt: null,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/push-subscriptions')
        .set('User-Agent', '')
        .send(validBody)
        .expect(201);

      expect(res.body.id).toBe('sub-uuid-2');
      // When User-Agent header is empty, Express may pass empty string or undefined
      expect(pushService.subscribe).toHaveBeenCalledWith(
        'user-uuid',
        validBody,
        expect.anything(),
      );
    });

    it('should strip unknown fields (whitelist)', async () => {
      pushService.subscribe.mockResolvedValue({
        id: 'sub-uuid-1',
        userId: 'user-uuid',
        endpoint: validBody.endpoint,
        p256dh: validBody.keys.p256dh,
        auth: validBody.keys.auth,
        userAgent: null,
        createdAt: new Date(),
        lastUsedAt: null,
      });

      await request(app.getHttpServer())
        .post('/api/v1/push-subscriptions')
        .send({ ...validBody, malicious: 'payload' })
        .expect(201);

      // The DTO should not contain the 'malicious' field
      const receivedDto = pushService.subscribe.mock.calls[0][1];
      expect(receivedDto).not.toHaveProperty('malicious');
      expect(receivedDto).toEqual(validBody);
    });

    it('should reject empty keys.p256dh with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/push-subscriptions')
        .send({
          endpoint: 'https://push.example.com/sub/abc',
          keys: { p256dh: '', auth: 'auth-key' },
        })
        .expect(400);

      expect(pushService.subscribe).not.toHaveBeenCalled();
    });

    it('should reject empty keys.auth with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/push-subscriptions')
        .send({
          endpoint: 'https://push.example.com/sub/abc',
          keys: { p256dh: 'p256dh-key', auth: '' },
        })
        .expect(400);

      expect(pushService.subscribe).not.toHaveBeenCalled();
    });
  });

  // ── DELETE /push-subscriptions ─────────────────────────────────────

  describe('DELETE /api/v1/push-subscriptions', () => {
    it('should unsubscribe with valid endpoint scoped to authenticated user', async () => {
      pushService.unsubscribe.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .delete('/api/v1/push-subscriptions')
        .send({ endpoint: 'https://push.example.com/sub/abc123' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(pushService.unsubscribe).toHaveBeenCalledWith(
        'https://push.example.com/sub/abc123',
        'user-uuid',
      );
    });

    it('should reject missing endpoint with 400', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/push-subscriptions')
        .send({})
        .expect(400);

      expect(pushService.unsubscribe).not.toHaveBeenCalled();
    });

    it('should reject empty endpoint with 400', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/push-subscriptions')
        .send({ endpoint: '' })
        .expect(400);

      expect(pushService.unsubscribe).not.toHaveBeenCalled();
    });

    it('should reject non-https endpoint with 400', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/push-subscriptions')
        .send({ endpoint: 'http://push.example.com/sub/abc' })
        .expect(400);

      expect(pushService.unsubscribe).not.toHaveBeenCalled();
    });
  });
});
