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
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';

function mockAccountService() {
  return {
    getPendingEmailChange: jest.fn<any>(),
    createEmailChange: jest.fn<any>(),
    resendEmailChange: jest.fn<any>(),
    cancelEmailChange: jest.fn<any>(),
    confirmEmailChange: jest.fn<any>(),
  };
}

describe('AccountController (integration)', () => {
  let app: INestApplication;
  let accountService: ReturnType<typeof mockAccountService>;

  beforeEach(async () => {
    accountService = mockAccountService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountController],
      providers: [{ provide: AccountService, useValue: accountService }],
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

  describe('GET /api/v1/account/email-change', () => {
    it('returns the current pending email change for the signed-in user', async () => {
      accountService.getPendingEmailChange.mockResolvedValue({
        pendingEmailChange: {
          id: 'req-1',
          currentEmail: 'alice@test.com',
          newEmail: 'new@test.com',
          expiresAt: '2026-04-01T10:00:00.000Z',
          createdAt: '2026-03-31T10:00:00.000Z',
        },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/account/email-change')
        .expect(200);

      expect(res.body.pendingEmailChange.newEmail).toBe('new@test.com');
      expect(accountService.getPendingEmailChange).toHaveBeenCalledWith(
        'user-uuid',
      );
    });
  });

  describe('POST /api/v1/account/email-change', () => {
    it('creates a new email change request', async () => {
      accountService.createEmailChange.mockResolvedValue({
        message: 'Confirmation email sent.',
        pendingEmailChange: {
          id: 'req-1',
          currentEmail: 'alice@test.com',
          newEmail: 'new@test.com',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/account/email-change')
        .send({ newEmail: 'new@test.com' })
        .expect(201);

      expect(res.body.message).toBe('Confirmation email sent.');
      expect(accountService.createEmailChange).toHaveBeenCalledWith(
        'user-uuid',
        { newEmail: 'new@test.com' },
      );
    });

    it('rejects an invalid email payload', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/account/email-change')
        .send({ newEmail: 'invalid-email' })
        .expect(400);

      expect(accountService.createEmailChange).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/account/email-change/resend', () => {
    it('resends the current email change confirmation', async () => {
      accountService.resendEmailChange.mockResolvedValue({
        message: 'Confirmation email resent.',
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/account/email-change/resend')
        .expect(200);

      expect(res.body.message).toBe('Confirmation email resent.');
      expect(accountService.resendEmailChange).toHaveBeenCalledWith(
        'user-uuid',
      );
    });
  });

  describe('DELETE /api/v1/account/email-change', () => {
    it('cancels the active email change request', async () => {
      accountService.cancelEmailChange.mockResolvedValue({
        message: 'Pending email change cancelled.',
      });

      const res = await request(app.getHttpServer())
        .delete('/api/v1/account/email-change')
        .expect(200);

      expect(res.body.message).toBe('Pending email change cancelled.');
      expect(accountService.cancelEmailChange).toHaveBeenCalledWith(
        'user-uuid',
      );
    });
  });

  describe('GET /api/v1/account/confirm-email-change', () => {
    it('confirms an email change token without auth', async () => {
      accountService.confirmEmailChange.mockResolvedValue({
        message: 'Email address updated successfully.',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/account/confirm-email-change?token=confirm-token')
        .expect(200);

      expect(res.body.message).toBe('Email address updated successfully.');
      expect(accountService.confirmEmailChange).toHaveBeenCalledWith(
        'confirm-token',
      );
    });

    it('rejects a missing token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/account/confirm-email-change')
        .expect(400);

      expect(accountService.confirmEmailChange).not.toHaveBeenCalled();
    });
  });
});
