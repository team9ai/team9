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
  UnauthorizedException,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import { BotService } from '../bot/bot.service.js';
import { InternalAuthController } from './internal-auth.controller.js';
import { InternalAuthGuard } from './internal-auth.guard.js';

function mockBotService() {
  return {
    validateAccessTokenWithContext: jest.fn<any>(),
  };
}

describe('InternalAuthController (integration)', () => {
  let app: INestApplication;
  let botService: ReturnType<typeof mockBotService>;
  const previousInternalToken = process.env.INTERNAL_AUTH_VALIDATION_TOKEN;
  const wellFormedBotToken = `t9bot_${'a'.repeat(96)}`;
  const anotherWellFormedBotToken = `t9bot_${'b'.repeat(96)}`;

  beforeEach(async () => {
    process.env.INTERNAL_AUTH_VALIDATION_TOKEN = 'internal-secret';
    botService = mockBotService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InternalAuthController],
      providers: [
        InternalAuthGuard,
        { provide: BotService, useValue: botService },
      ],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterEach(async () => {
    if (previousInternalToken === undefined) {
      delete process.env.INTERNAL_AUTH_VALIDATION_TOKEN;
    } else {
      process.env.INTERNAL_AUTH_VALIDATION_TOKEN = previousInternalToken;
    }
    await app.close();
  });

  it('returns 200 with validation context for a valid bot token', async () => {
    botService.validateAccessTokenWithContext.mockResolvedValue({
      botId: 'bot-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/internal/auth/validate-bot-token')
      .set('Authorization', 'Bearer internal-secret')
      .send({ token: wellFormedBotToken })
      .expect(200);

    expect(res.body).toEqual({
      valid: true,
      botId: 'bot-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
    });
    expect(botService.validateAccessTokenWithContext).toHaveBeenCalledWith(
      wellFormedBotToken,
    );
  });

  it('returns 400 when token is missing', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/internal/auth/validate-bot-token')
      .set('Authorization', 'Bearer internal-secret')
      .send({})
      .expect(400);

    expect(botService.validateAccessTokenWithContext).not.toHaveBeenCalled();
  });

  it("returns 404 with {valid:false,error:'invalid token'} for malformed token format", async () => {
    botService.validateAccessTokenWithContext.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .post('/api/v1/internal/auth/validate-bot-token')
      .set('Authorization', 'Bearer internal-secret')
      .send({ token: 'invalid-token-format' })
      .expect(404);

    expect(res.body).toEqual({
      valid: false,
      error: 'invalid token',
    });
    expect(botService.validateAccessTokenWithContext).toHaveBeenCalledWith(
      'invalid-token-format',
    );
  });

  it('returns 401 when bearer secret is invalid', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/internal/auth/validate-bot-token')
      .set('Authorization', 'Bearer wrong-secret')
      .send({ token: wellFormedBotToken })
      .expect(401);

    expect(botService.validateAccessTokenWithContext).not.toHaveBeenCalled();
  });

  it("returns 404 with {valid:false,error:'invalid token'} for an invalid bot token", async () => {
    botService.validateAccessTokenWithContext.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .post('/api/v1/internal/auth/validate-bot-token')
      .set('Authorization', 'Bearer internal-secret')
      .send({ token: anotherWellFormedBotToken })
      .expect(404);

    expect(res.body).toEqual({
      valid: false,
      error: 'invalid token',
    });
    expect(botService.validateAccessTokenWithContext).toHaveBeenCalledWith(
      anotherWellFormedBotToken,
    );
  });
});

describe('InternalAuthGuard', () => {
  const previousInternalToken = process.env.INTERNAL_AUTH_VALIDATION_TOKEN;

  afterEach(() => {
    if (previousInternalToken === undefined) {
      delete process.env.INTERNAL_AUTH_VALIDATION_TOKEN;
    } else {
      process.env.INTERNAL_AUTH_VALIDATION_TOKEN = previousInternalToken;
    }
  });

  it('throws at construction when INTERNAL_AUTH_VALIDATION_TOKEN is missing', () => {
    delete process.env.INTERNAL_AUTH_VALIDATION_TOKEN;

    expect(() => new InternalAuthGuard()).toThrow(
      'Missing required environment variable: INTERNAL_AUTH_VALIDATION_TOKEN',
    );
  });

  it('throws at construction when INTERNAL_AUTH_VALIDATION_TOKEN is empty', () => {
    process.env.INTERNAL_AUTH_VALIDATION_TOKEN = '';

    expect(() => new InternalAuthGuard()).toThrow(
      'Missing required environment variable: INTERNAL_AUTH_VALIDATION_TOKEN',
    );
  });

  it('returns 401 for non-string authorization header shapes', () => {
    process.env.INTERNAL_AUTH_VALIDATION_TOKEN = 'internal-secret';
    const guard = new InternalAuthGuard();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: ['Bearer internal-secret'] },
        }),
      }),
    };

    expect(() => guard.canActivate(context as any)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects bearer tokens with a different length without throwing comparison errors', () => {
    process.env.INTERNAL_AUTH_VALIDATION_TOKEN = 'internal-secret';
    const guard = new InternalAuthGuard();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer short' },
        }),
      }),
    };

    expect(() => guard.canActivate(context as any)).toThrow(
      UnauthorizedException,
    );
  });
});
