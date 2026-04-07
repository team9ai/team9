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
import { ExpoPushService } from './push.service.js';

function mockExpoPushService() {
  return {
    isEnabled: jest.fn<any>().mockReturnValue(true),
    registerToken: jest.fn<any>(),
    unregisterToken: jest.fn<any>(),
    sendPush: jest.fn<any>(),
    sendToExpo: jest.fn<any>(),
    removeInvalidTokens: jest.fn<any>(),
  };
}

describe('PushController (integration)', () => {
  let app: INestApplication;
  let expoPushService: ReturnType<typeof mockExpoPushService>;

  beforeEach(async () => {
    expoPushService = mockExpoPushService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PushController],
      providers: [{ provide: ExpoPushService, useValue: expoPushService }],
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
      expoPushService.registerToken.mockResolvedValue({
        message: 'Push token registered.',
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/push/register')
        .send({ token: 'ExponentPushToken[abc123]', platform: 'ios' })
        .expect(201);

      expect(res.body.message).toBe('Push token registered.');
      expect(expoPushService.registerToken).toHaveBeenCalledWith(
        'user-uuid',
        'ExponentPushToken[abc123]',
        'ios',
      );
    });

    it('registers an android token', async () => {
      expoPushService.registerToken.mockResolvedValue({
        message: 'Push token registered.',
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/push/register')
        .send({ token: 'ExponentPushToken[xyz789]', platform: 'android' })
        .expect(201);

      expect(res.body.message).toBe('Push token registered.');
      expect(expoPushService.registerToken).toHaveBeenCalledWith(
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

      expect(expoPushService.registerToken).not.toHaveBeenCalled();
    });

    it('rejects an empty token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/push/register')
        .send({ token: '', platform: 'ios' })
        .expect(400);

      expect(expoPushService.registerToken).not.toHaveBeenCalled();
    });

    it('rejects a missing platform', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/push/register')
        .send({ token: 'ExponentPushToken[abc123]' })
        .expect(400);

      expect(expoPushService.registerToken).not.toHaveBeenCalled();
    });

    it('rejects an invalid platform', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/push/register')
        .send({ token: 'ExponentPushToken[abc123]', platform: 'web' })
        .expect(400);

      expect(expoPushService.registerToken).not.toHaveBeenCalled();
    });

    it('rejects a non-string token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/push/register')
        .send({ token: 12345, platform: 'ios' })
        .expect(400);

      expect(expoPushService.registerToken).not.toHaveBeenCalled();
    });

    it('strips unknown properties from the request body', async () => {
      expoPushService.registerToken.mockResolvedValue({
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

      expect(expoPushService.registerToken).toHaveBeenCalledWith(
        'user-uuid',
        'ExponentPushToken[abc123]',
        'ios',
      );
    });
  });

  describe('DELETE /api/v1/push/register', () => {
    it('removes a push token for the authenticated user', async () => {
      expoPushService.unregisterToken.mockResolvedValue({
        message: 'Push token removed.',
      });

      const res = await request(app.getHttpServer())
        .delete('/api/v1/push/register')
        .send({ token: 'ExponentPushToken[abc123]' })
        .expect(200);

      expect(res.body.message).toBe('Push token removed.');
      expect(expoPushService.unregisterToken).toHaveBeenCalledWith(
        'user-uuid',
        'ExponentPushToken[abc123]',
      );
    });

    it('rejects a missing token', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/push/register')
        .send({})
        .expect(400);

      expect(expoPushService.unregisterToken).not.toHaveBeenCalled();
    });

    it('rejects an empty token', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/push/register')
        .send({ token: '' })
        .expect(400);

      expect(expoPushService.unregisterToken).not.toHaveBeenCalled();
    });
  });
});
