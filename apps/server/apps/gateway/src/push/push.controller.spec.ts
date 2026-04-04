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
import { AuthGuard } from '@team9/auth';
import { PushController } from './push.controller.js';
import { PushService } from './push.service.js';

function mockPushService() {
  return {
    registerToken: jest.fn<any>(),
    unregisterToken: jest.fn<any>(),
    sendPush: jest.fn<any>(),
    sendToExpo: jest.fn<any>(),
    removeInvalidTokens: jest.fn<any>(),
  };
}

describe('PushController (integration)', () => {
  let app: INestApplication;
  let pushService: ReturnType<typeof mockPushService>;

  beforeEach(async () => {
    pushService = mockPushService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PushController],
      providers: [{ provide: PushService, useValue: pushService }],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = { sub: 'user-uuid', email: 'alice@test.com' };
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

  describe('POST /api/v1/push/register', () => {
    it('registers a push token for the authenticated user', async () => {
      pushService.registerToken.mockResolvedValue({
        message: 'Push token registered.',
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/push/register')
        .send({ token: 'ExponentPushToken[abc123]', platform: 'ios' })
        .expect(201);

      expect(res.body.message).toBe('Push token registered.');
      expect(pushService.registerToken).toHaveBeenCalledWith(
        'user-uuid',
        'ExponentPushToken[abc123]',
        'ios',
      );
    });

    it('registers an android token', async () => {
      pushService.registerToken.mockResolvedValue({
        message: 'Push token registered.',
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/push/register')
        .send({ token: 'ExponentPushToken[xyz789]', platform: 'android' })
        .expect(201);

      expect(res.body.message).toBe('Push token registered.');
      expect(pushService.registerToken).toHaveBeenCalledWith(
        'user-uuid',
        'ExponentPushToken[xyz789]',
        'android',
      );
    });

    it('rejects a missing token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/push/register')
        .send({ platform: 'ios' })
        .expect(400);

      expect(pushService.registerToken).not.toHaveBeenCalled();
    });

    it('rejects an empty token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/push/register')
        .send({ token: '', platform: 'ios' })
        .expect(400);

      expect(pushService.registerToken).not.toHaveBeenCalled();
    });

    it('rejects a missing platform', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/push/register')
        .send({ token: 'ExponentPushToken[abc123]' })
        .expect(400);

      expect(pushService.registerToken).not.toHaveBeenCalled();
    });

    it('rejects an invalid platform', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/push/register')
        .send({ token: 'ExponentPushToken[abc123]', platform: 'web' })
        .expect(400);

      expect(pushService.registerToken).not.toHaveBeenCalled();
    });

    it('rejects a non-string token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/push/register')
        .send({ token: 12345, platform: 'ios' })
        .expect(400);

      expect(pushService.registerToken).not.toHaveBeenCalled();
    });

    it('strips unknown properties from the request body', async () => {
      pushService.registerToken.mockResolvedValue({
        message: 'Push token registered.',
      });

      await request(app.getHttpServer())
        .post('/api/v1/push/register')
        .send({
          token: 'ExponentPushToken[abc123]',
          platform: 'ios',
          extraField: 'should be stripped',
        })
        .expect(201);

      expect(pushService.registerToken).toHaveBeenCalledWith(
        'user-uuid',
        'ExponentPushToken[abc123]',
        'ios',
      );
    });
  });

  describe('DELETE /api/v1/push/register', () => {
    it('removes a push token for the authenticated user', async () => {
      pushService.unregisterToken.mockResolvedValue({
        message: 'Push token removed.',
      });

      const res = await request(app.getHttpServer())
        .delete('/api/v1/push/register')
        .send({ token: 'ExponentPushToken[abc123]' })
        .expect(200);

      expect(res.body.message).toBe('Push token removed.');
      expect(pushService.unregisterToken).toHaveBeenCalledWith(
        'user-uuid',
        'ExponentPushToken[abc123]',
      );
    });

    it('rejects a missing token', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/push/register')
        .send({})
        .expect(400);

      expect(pushService.unregisterToken).not.toHaveBeenCalled();
    });

    it('rejects an empty token', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/push/register')
        .send({ token: '' })
        .expect(400);

      expect(pushService.unregisterToken).not.toHaveBeenCalled();
    });
  });
});
