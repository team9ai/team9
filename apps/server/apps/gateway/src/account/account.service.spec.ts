import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { DATABASE_CONNECTION } from '@team9/database';
import { EmailService } from '@team9/email';
import { AccountService } from './account.service.js';

type MockFn = jest.Mock<(...args: any[]) => any>;

function mockDb() {
  const chain: Record<string, MockFn> = {};
  const methods = [
    'select',
    'from',
    'where',
    'orderBy',
    'limit',
    'insert',
    'values',
    'returning',
    'update',
    'set',
    'delete',
    'transaction',
  ];

  for (const method of methods) {
    chain[method] = jest.fn<any>().mockReturnValue(chain);
  }

  chain.limit.mockResolvedValue([]);
  chain.returning.mockResolvedValue([]);
  chain.where.mockReturnValue(chain);
  chain.values.mockReturnValue(chain);
  chain.set.mockReturnValue(chain);
  chain.transaction.mockImplementation(async (cb: any) => cb(chain));

  return chain;
}

const USER_ROW = {
  id: 'user-uuid',
  email: 'alice@test.com',
  username: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
  emailVerified: false,
  emailVerifiedAt: null,
  userType: 'human',
  isActive: true,
  createdAt: new Date('2026-03-31T10:00:00.000Z'),
  updatedAt: new Date('2026-03-31T10:00:00.000Z'),
};

const PENDING_REQUEST = {
  id: 'req-uuid',
  userId: USER_ROW.id,
  currentEmail: USER_ROW.email,
  newEmail: 'new@test.com',
  tokenHash: 'stored-hash',
  status: 'pending',
  expiresAt: new Date('2026-04-01T10:00:00.000Z'),
  confirmedAt: null,
  createdAt: new Date('2026-03-31T10:00:00.000Z'),
  updatedAt: new Date('2026-03-31T10:00:00.000Z'),
};

describe('AccountService', () => {
  let service: AccountService;
  let db: ReturnType<typeof mockDb>;
  let emailService: Record<string, MockFn>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    process.env.APP_URL = 'https://app.team9.test';
    process.env.API_URL = 'https://api.team9.test';
    process.env.APP_ENV = 'test';
    delete process.env.DEV_SKIP_EMAIL_VERIFICATION;

    db = mockDb();
    emailService = {
      sendEmailChangeConfirmationEmail: jest.fn<any>().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = module.get<AccountService>(AccountService);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('getPendingEmailChange', () => {
    it('returns the pending request for the signed-in user', async () => {
      db.limit.mockResolvedValueOnce([PENDING_REQUEST]);

      await expect(service.getPendingEmailChange(USER_ROW.id)).resolves.toEqual(
        {
          pendingEmailChange: {
            id: PENDING_REQUEST.id,
            currentEmail: PENDING_REQUEST.currentEmail,
            newEmail: PENDING_REQUEST.newEmail,
            expiresAt: PENDING_REQUEST.expiresAt,
            createdAt: PENDING_REQUEST.createdAt,
          },
        },
      );

      expect(db.orderBy).toHaveBeenCalled();
    });

    it('returns null when no pending request exists', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(service.getPendingEmailChange(USER_ROW.id)).resolves.toEqual(
        {
          pendingEmailChange: null,
        },
      );
    });
  });

  describe('createEmailChange', () => {
    it('rejects a target email that is already used by another account', async () => {
      db.limit
        .mockResolvedValueOnce([USER_ROW])
        .mockResolvedValueOnce([{ id: 'other-user', email: 'taken@test.com' }]);

      await expect(
        service.createEmailChange(USER_ROW.id, { newEmail: 'taken@test.com' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a target email reserved by another user pending request', async () => {
      db.limit
        .mockResolvedValueOnce([USER_ROW])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'other-pending',
            userId: 'other-user',
            newEmail: 'reserved@test.com',
            status: 'pending',
          },
        ]);

      await expect(
        service.createEmailChange(USER_ROW.id, {
          newEmail: 'reserved@test.com',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('replaces any existing pending request, stores only a hash, and sends confirmation mail', async () => {
      db.limit
        .mockResolvedValueOnce([USER_ROW])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([PENDING_REQUEST]);

      db.returning.mockResolvedValueOnce([
        {
          ...PENDING_REQUEST,
          newEmail: 'new@test.com',
          tokenHash: 'generated-hash',
        },
      ]);

      const result = await service.createEmailChange(USER_ROW.id, {
        newEmail: 'new@test.com',
      });

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'cancelled' }),
      );

      expect(db.insert).toHaveBeenCalled();

      const inserted = db.values.mock.calls[0][0];
      expect(inserted.userId).toBe(USER_ROW.id);
      expect(inserted.currentEmail).toBe(USER_ROW.email);
      expect(inserted.newEmail).toBe('new@test.com');
      expect(inserted.status).toBe('pending');

      const sentArgs =
        emailService.sendEmailChangeConfirmationEmail.mock.calls[0];
      expect(sentArgs[0]).toBe('new@test.com');
      expect(sentArgs[1]).toBe(USER_ROW.username);
      expect(sentArgs[2]).toBe(USER_ROW.email);

      const sentLink = sentArgs[3] as string;
      const rawToken = new URL(sentLink).searchParams.get('token');
      expect(rawToken).toBeTruthy();

      const expectedHash = crypto
        .createHash('sha256')
        .update(rawToken!)
        .digest('hex');

      expect(inserted.tokenHash).toBe(expectedHash);
      expect(inserted.tokenHash).not.toBe(rawToken);
      expect(sentLink).toBe(
        `https://api.team9.test/api/v1/account/confirm-email-change?token=${rawToken}`,
      );

      expect(result.pendingEmailChange?.newEmail).toBe('new@test.com');
    });
  });

  describe('resendEmailChange', () => {
    it('resends confirmation for the current pending request', async () => {
      db.limit
        .mockResolvedValueOnce([PENDING_REQUEST])
        .mockResolvedValueOnce([USER_ROW])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([PENDING_REQUEST]);

      db.returning.mockResolvedValueOnce([
        {
          ...PENDING_REQUEST,
          tokenHash: 'updated-hash',
          expiresAt: new Date('2026-04-02T10:00:00.000Z'),
        },
      ]);

      const result = await service.resendEmailChange(USER_ROW.id);

      expect(db.update).toHaveBeenCalled();

      const resentUpdate = db.set.mock.calls.at(-1)?.[0];
      const resentArgs =
        emailService.sendEmailChangeConfirmationEmail.mock.calls[0];
      const resentLink = resentArgs[3] as string;
      const resentToken = new URL(resentLink).searchParams.get('token');
      const expectedHash = crypto
        .createHash('sha256')
        .update(resentToken!)
        .digest('hex');

      expect(resentUpdate).toEqual(
        expect.objectContaining({
          tokenHash: expectedHash,
          status: 'pending',
        }),
      );
      expect(emailService.sendEmailChangeConfirmationEmail).toHaveBeenCalled();
      expect(result.pendingEmailChange?.id).toBe(PENDING_REQUEST.id);
    });

    it('fails when the user has no pending request', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(service.resendEmailChange(USER_ROW.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('cancelEmailChange', () => {
    it('cancels the active pending request', async () => {
      db.returning.mockResolvedValueOnce([PENDING_REQUEST]);

      await expect(service.cancelEmailChange(USER_ROW.id)).resolves.toEqual({
        message: 'Pending email change cancelled.',
      });

      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'cancelled' }),
      );
    });
  });

  describe('confirmEmailChange', () => {
    it('updates the user email, marks it verified, and confirms the request', async () => {
      const rawToken = 'abc123token';
      const tokenHash = crypto
        .createHash('sha256')
        .update(rawToken)
        .digest('hex');

      db.limit
        .mockResolvedValueOnce([{ ...PENDING_REQUEST, tokenHash }])
        .mockResolvedValueOnce([USER_ROW])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ ...PENDING_REQUEST, tokenHash }]);

      db.returning
        .mockResolvedValueOnce([
          {
            ...PENDING_REQUEST,
            tokenHash,
            status: 'confirmed',
          },
        ])
        .mockResolvedValueOnce([
          {
            ...USER_ROW,
            email: PENDING_REQUEST.newEmail,
            emailVerified: true,
            emailVerifiedAt: new Date('2026-03-31T11:00:00.000Z'),
          },
        ]);

      await expect(service.confirmEmailChange(rawToken)).resolves.toEqual({
        message: 'Email address updated successfully.',
      });

      expect(db.transaction).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          email: PENDING_REQUEST.newEmail,
          emailVerified: true,
        }),
      );
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'confirmed',
        }),
      );
    });

    it('rejects expired requests', async () => {
      const rawToken = 'expired-token';
      const tokenHash = crypto
        .createHash('sha256')
        .update(rawToken)
        .digest('hex');

      db.limit.mockResolvedValueOnce([
        {
          ...PENDING_REQUEST,
          tokenHash,
          expiresAt: new Date('2026-03-30T10:00:00.000Z'),
        },
      ]);
      db.returning.mockResolvedValueOnce([
        {
          ...PENDING_REQUEST,
          tokenHash,
          status: 'expired',
        },
      ]);

      await expect(service.confirmEmailChange(rawToken)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects stale tokens when the request is no longer pending at confirm time', async () => {
      const rawToken = 'stale-token';
      const tokenHash = crypto
        .createHash('sha256')
        .update(rawToken)
        .digest('hex');

      db.limit
        .mockResolvedValueOnce([{ ...PENDING_REQUEST, tokenHash }])
        .mockResolvedValueOnce([USER_ROW])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ ...PENDING_REQUEST, tokenHash }]);

      db.returning.mockResolvedValueOnce([]);

      await expect(service.confirmEmailChange(rawToken)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('maps a late user email unique violation to ConflictException', async () => {
      const rawToken = 'late-race-token';
      const tokenHash = crypto
        .createHash('sha256')
        .update(rawToken)
        .digest('hex');

      db.limit
        .mockResolvedValueOnce([{ ...PENDING_REQUEST, tokenHash }])
        .mockResolvedValueOnce([USER_ROW])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ ...PENDING_REQUEST, tokenHash }]);

      db.returning
        .mockResolvedValueOnce([
          {
            ...PENDING_REQUEST,
            tokenHash,
            status: 'confirmed',
          },
        ])
        .mockImplementationOnce(async () => {
          throw Object.assign(
            new Error('duplicate key value violates unique constraint'),
            { code: '23505' },
          );
        });

      await expect(service.confirmEmailChange(rawToken)).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
