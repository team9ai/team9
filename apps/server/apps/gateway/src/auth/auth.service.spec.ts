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
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OAuth2Client } from 'google-auth-library';
import * as crypto from 'crypto';
import { AuthService } from './auth.service.js';
import { USER_EVENTS } from './events/user.events.js';
import { RedisService } from '@team9/redis';
import { DATABASE_CONNECTION } from '@team9/database';
import { EmailService } from '@team9/email';

// ── helpers ──────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

function mockDb() {
  const chain: Record<string, MockFn> = {};
  const methods = [
    'select',
    'from',
    'where',
    'limit',
    'insert',
    'values',
    'returning',
    'update',
    'set',
    'delete',
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.limit.mockResolvedValue([]);
  chain.returning.mockResolvedValue([]);
  // delete().where() is terminal in some flows
  chain.where.mockReturnValue(chain);
  return chain;
}

const USER_ROW = {
  id: 'user-uuid',
  email: 'alice@test.com',
  username: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
  emailVerified: true,
  emailVerifiedAt: new Date(),
  userType: 'human',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthService', () => {
  let service: AuthService;
  let db: ReturnType<typeof mockDb>;
  let redisService: Record<string, MockFn>;
  let jwtService: Record<string, MockFn>;
  let emailService: Record<string, MockFn>;
  let eventEmitter: Record<string, MockFn>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    process.env.APP_URL = 'https://app.test';
    process.env.DEV_SKIP_EMAIL_VERIFICATION = 'true';
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';

    db = mockDb();
    redisService = {
      get: jest.fn<any>().mockResolvedValue(null),
      set: jest.fn<any>().mockResolvedValue(undefined),
      del: jest.fn<any>().mockResolvedValue(undefined),
      incr: jest.fn<any>().mockResolvedValue(1),
      expire: jest.fn<any>().mockResolvedValue(undefined),
    };
    jwtService = {
      sign: jest.fn<any>().mockReturnValue('mock-token'),
      verify: jest.fn<any>(),
    };
    emailService = {
      sendVerificationCodeEmail: jest.fn<any>().mockResolvedValue(true),
      sendVerificationEmail: jest.fn<any>().mockResolvedValue(true),
      sendLoginEmail: jest.fn<any>().mockResolvedValue(true),
    };
    eventEmitter = {
      emit: jest.fn<any>(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: JwtService, useValue: jwtService },
        { provide: RedisService, useValue: redisService },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    // Stub generateTokenPair to avoid needing real JWT keys
    jest.spyOn(service as any, 'generateTokenPair').mockReturnValue({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  // ── authStart ─────────────────────────────────────────────────────

  describe('authStart', () => {
    it('should return need_display_name for unknown email without displayName', async () => {
      db.limit.mockResolvedValue([]); // no existing user

      const result = await service.authStart({ email: 'new@test.com' });

      expect(result.action).toBe('need_display_name');
      expect(result.email).toBe('new@test.com');
      expect(result.challengeId).toBeUndefined();
    });

    it('should send code for unknown email with displayName (signup flow)', async () => {
      db.limit.mockResolvedValue([]); // no existing user

      const result = await service.authStart({
        email: 'new@test.com',
        displayName: 'New User',
      });

      expect(result.action).toBe('code_sent');
      expect(result.challengeId).toBeDefined();
      expect(result.expiresInSeconds).toBe(600);
      // Should store challenge in Redis
      expect(redisService.set).toHaveBeenCalledWith(
        expect.stringContaining('im:auth_challenge:'),
        expect.stringContaining('"flow":"signup"'),
        600,
      );
    });

    it('should send code for existing verified user (login flow)', async () => {
      db.limit.mockResolvedValue([USER_ROW]);

      const result = await service.authStart({ email: 'alice@test.com' });

      expect(result.action).toBe('code_sent');
      expect(redisService.set).toHaveBeenCalledWith(
        expect.stringContaining('im:auth_challenge:'),
        expect.stringContaining('"flow":"login"'),
        600,
      );
    });

    it('should send verification code email when dev email skipping is disabled', async () => {
      process.env.DEV_SKIP_EMAIL_VERIFICATION = 'false';
      db.limit.mockResolvedValue([USER_ROW]);

      const result = await service.authStart({ email: 'alice@test.com' });

      expect(result.action).toBe('code_sent');
      expect(result).not.toHaveProperty('verificationCode');
      expect(emailService.sendVerificationCodeEmail).toHaveBeenCalledWith(
        'alice@test.com',
        expect.any(String),
        10,
      );
    });

    it('should send code for existing unverified user (verify_existing_user flow)', async () => {
      const unverifiedUser = { ...USER_ROW, emailVerified: false };
      db.limit.mockResolvedValue([unverifiedUser]);

      const result = await service.authStart({ email: 'alice@test.com' });

      expect(result.action).toBe('code_sent');
      expect(redisService.set).toHaveBeenCalledWith(
        expect.stringContaining('im:auth_challenge:'),
        expect.stringContaining('"flow":"verify_existing_user"'),
        600,
      );
    });

    it('should reject non-human user types', async () => {
      const botUser = { ...USER_ROW, userType: 'bot' };
      db.limit.mockResolvedValue([botUser]);

      await expect(
        service.authStart({ email: 'bot@test.com' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject inactive user', async () => {
      const inactiveUser = { ...USER_ROW, isActive: false };
      db.limit.mockResolvedValue([inactiveUser]);

      await expect(
        service.authStart({ email: 'alice@test.com' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should enforce rate limiting', async () => {
      redisService.get.mockResolvedValue('1'); // rate limit hit

      await expect(
        service.authStart({ email: 'alice@test.com' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── googleLogin ───────────────────────────────────────────────────

  describe('googleLogin', () => {
    function mockGooglePayload(payload: Record<string, any>) {
      jest
        .spyOn(OAuth2Client.prototype as any, 'verifyIdToken')
        .mockResolvedValue({
          getPayload: () => payload,
        } as any);
    }

    it('should seed new Google users with Google name and picture', async () => {
      const googlePayload = {
        email: 'new-google@test.com',
        name: 'Google Name',
        picture: 'https://lh3.googleusercontent.com/avatar.jpg',
      };
      mockGooglePayload(googlePayload);

      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([
        {
          ...USER_ROW,
          id: 'google-user-uuid',
          email: googlePayload.email,
          username: 'google_name',
          displayName: googlePayload.name,
          avatarUrl: googlePayload.picture,
        },
      ]);

      const result = await service.googleLogin({ credential: 'google-token' });

      expect(result.user.displayName).toBe('Google Name');
      expect(result.user.avatarUrl).toBe(googlePayload.picture);
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: 'Google Name',
          avatarUrl: googlePayload.picture,
          emailVerified: true,
        }),
      );
    });

    it('should fall back to gravatar when the Google picture is missing', async () => {
      const email = 'fallback@test.com';
      const googlePayload = {
        email,
        name: 'Fallback Name',
      };
      mockGooglePayload(googlePayload);

      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([
        {
          ...USER_ROW,
          id: 'fallback-user-uuid',
          email,
          username: 'fallback_name',
          displayName: googlePayload.name,
          avatarUrl: `https://www.gravatar.com/avatar/${crypto
            .createHash('md5')
            .update(email.trim().toLowerCase())
            .digest('hex')}?d=identicon`,
        },
      ]);

      const result = await service.googleLogin({ credential: 'google-token' });

      expect(result.user.displayName).toBe('Fallback Name');
      expect(result.user.avatarUrl).toBe(
        `https://www.gravatar.com/avatar/${crypto
          .createHash('md5')
          .update(email.trim().toLowerCase())
          .digest('hex')}?d=identicon`,
      );
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: 'Fallback Name',
          avatarUrl: `https://www.gravatar.com/avatar/${crypto
            .createHash('md5')
            .update(email.trim().toLowerCase())
            .digest('hex')}?d=identicon`,
        }),
      );
    });

    it('should not overwrite profile data for an existing user', async () => {
      const existingUser = {
        ...USER_ROW,
        email: 'existing-google@test.com',
        username: 'existing_user',
        displayName: 'Existing Profile Name',
        avatarUrl: 'https://example.com/existing.png',
        emailVerified: false,
      };
      mockGooglePayload({
        email: existingUser.email,
        name: 'New Google Name',
        picture: 'https://lh3.googleusercontent.com/new-picture.jpg',
      });

      db.limit.mockResolvedValueOnce([existingUser]);

      const result = await service.googleLogin({ credential: 'google-token' });

      expect(result.user.displayName).toBe(existingUser.displayName);
      expect(result.user.avatarUrl).toBe(existingUser.avatarUrl);
      expect(db.insert).not.toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledTimes(1);
      const updatePayload = db.set.mock.calls[0][0];
      expect(updatePayload).toStrictEqual({
        emailVerified: true,
        emailVerifiedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
      expect(updatePayload).not.toHaveProperty('displayName');
      expect(updatePayload).not.toHaveProperty('avatarUrl');
      expect(db.set.mock.calls).toHaveLength(1);
    });
  });

  // ── verifyCode ────────────────────────────────────────────────────

  describe('verifyCode', () => {
    function makeChallenge(overrides: Record<string, any> = {}): {
      challenge: any;
      code: string;
      challengeId: string;
    } {
      const code = '123456';
      const codeHash = crypto.createHash('sha256').update(code).digest('hex');
      const challengeId = 'challenge-id';
      const challenge = {
        status: 'pending',
        email: 'alice@test.com',
        codeHash,
        attemptsRemaining: 5,
        flow: 'login',
        ...overrides,
      };
      return { challenge, code, challengeId };
    }

    it('should authenticate existing user with correct code (login flow)', async () => {
      const { challenge, code, challengeId } = makeChallenge();
      redisService.get.mockResolvedValue(JSON.stringify(challenge));
      db.limit.mockResolvedValue([USER_ROW]);

      const result = await service.verifyCode({
        email: 'alice@test.com',
        challengeId,
        code,
      });

      expect(result.user.email).toBe('alice@test.com');
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      // Challenge should be marked as verified
      expect(redisService.set).toHaveBeenCalledWith(
        expect.stringContaining('im:auth_challenge:'),
        expect.stringContaining('"status":"verified"'),
        60,
      );
    });

    it('should mark email as verified for verify_existing_user flow', async () => {
      const { challenge, code, challengeId } = makeChallenge({
        flow: 'verify_existing_user',
      });
      const unverifiedUser = { ...USER_ROW, emailVerified: false };
      redisService.get.mockResolvedValue(JSON.stringify(challenge));
      db.limit.mockResolvedValue([unverifiedUser]);

      await service.verifyCode({
        email: 'alice@test.com',
        challengeId,
        code,
      });

      // Should update user emailVerified
      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ emailVerified: true }),
      );
    });

    it('should create new user for signup flow', async () => {
      const { challenge, code, challengeId } = makeChallenge({
        flow: 'signup',
        email: 'new@test.com',
        signupDisplayName: 'New User',
      });
      redisService.get.mockResolvedValue(JSON.stringify(challenge));

      // First limit call: completeSignup checks if email exists → no
      // Second limit call: generateUniqueUsername checks if username exists → no
      db.limit.mockImplementation((() => {
        return Promise.resolve([]);
      }) as any);

      const newUser = {
        ...USER_ROW,
        id: 'new-user-uuid',
        email: 'new@test.com',
        username: 'new_user',
        displayName: 'New User',
      };
      db.returning.mockResolvedValue([newUser]);

      const result = await service.verifyCode({
        email: 'new@test.com',
        challengeId,
        code,
      });

      expect(result.user.email).toBe('new@test.com');
      expect(db.insert).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'user.registered',
        expect.objectContaining({ userId: 'new-user-uuid' }),
      );
    });

    it('should reject expired/missing challenge', async () => {
      redisService.get.mockResolvedValue(null); // not found

      await expect(
        service.verifyCode({
          email: 'alice@test.com',
          challengeId: 'expired-id',
          code: '123456',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject already-used challenge', async () => {
      const { challenge, code, challengeId } = makeChallenge({
        status: 'verified',
      });
      redisService.get.mockResolvedValue(JSON.stringify(challenge));

      await expect(
        service.verifyCode({ email: 'alice@test.com', challengeId, code }),
      ).rejects.toThrow('Challenge has already been used');
    });

    it('should reject email mismatch', async () => {
      const { challenge, code, challengeId } = makeChallenge();
      redisService.get.mockResolvedValue(JSON.stringify(challenge));

      await expect(
        service.verifyCode({
          email: 'wrong@test.com',
          challengeId,
          code,
        }),
      ).rejects.toThrow('Email mismatch');
    });

    it('should decrement attempts on wrong code', async () => {
      const { challenge, challengeId } = makeChallenge();
      redisService.get.mockResolvedValue(JSON.stringify(challenge));

      await expect(
        service.verifyCode({
          email: 'alice@test.com',
          challengeId,
          code: '000000', // wrong code
        }),
      ).rejects.toThrow('Invalid verification code');

      // Should save decremented attempts
      expect(redisService.set).toHaveBeenCalledWith(
        expect.stringContaining('im:auth_challenge:'),
        expect.stringContaining('"attemptsRemaining":4'),
        600,
      );
    });

    it('should mark challenge as failed after exhausting attempts', async () => {
      const { challenge, challengeId } = makeChallenge({
        attemptsRemaining: 1,
      });
      redisService.get.mockResolvedValue(JSON.stringify(challenge));

      await expect(
        service.verifyCode({
          email: 'alice@test.com',
          challengeId,
          code: '000000',
        }),
      ).rejects.toThrow('Invalid verification code');

      // Status should be 'failed'
      expect(redisService.set).toHaveBeenCalledWith(
        expect.stringContaining('im:auth_challenge:'),
        expect.stringContaining('"status":"failed"'),
        600,
      );
    });

    it('should reject when attempts are already exhausted', async () => {
      const { challenge, code, challengeId } = makeChallenge({
        attemptsRemaining: 0,
      });
      redisService.get.mockResolvedValue(JSON.stringify(challenge));

      await expect(
        service.verifyCode({ email: 'alice@test.com', challengeId, code }),
      ).rejects.toThrow('Too many failed attempts');
    });

    it('should handle race condition in signup: user created between start and verify', async () => {
      const { challenge, code, challengeId } = makeChallenge({
        flow: 'signup',
        email: 'race@test.com',
        signupDisplayName: 'Race User',
      });
      redisService.get.mockResolvedValue(JSON.stringify(challenge));

      // completeSignup finds user already exists
      const existingUser = {
        ...USER_ROW,
        email: 'race@test.com',
        username: 'race_user',
      };
      db.limit.mockResolvedValue([existingUser]);

      const result = await service.verifyCode({
        email: 'race@test.com',
        challengeId,
        code,
      });

      // Should still return tokens for the existing user (not throw)
      expect(result.user.email).toBe('race@test.com');
      // Should NOT insert a new user
      expect(db.insert).not.toHaveBeenCalled();
    });
  });

  // ── login ────────────────────────────────────────────────────────

  describe('login', () => {
    it('should enforce rate limiting before reading the user record', async () => {
      redisService.get.mockResolvedValueOnce('1');

      await expect(service.login({ email: 'alice@test.com' })).rejects.toThrow(
        BadRequestException,
      );

      expect(db.limit).not.toHaveBeenCalled();
    });

    it('should reject login when the account does not exist', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(
        service.login({ email: 'missing@test.com' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject login for non-human users', async () => {
      db.limit.mockResolvedValueOnce([{ ...USER_ROW, userType: 'bot' }]);

      await expect(service.login({ email: 'bot@test.com' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject login for inactive users', async () => {
      db.limit.mockResolvedValueOnce([{ ...USER_ROW, isActive: false }]);

      await expect(
        service.login({ email: 'inactive@test.com' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should send verification email for unverified human user', async () => {
      const unverifiedUser = { ...USER_ROW, emailVerified: false };
      db.limit.mockResolvedValue([unverifiedUser]);

      const result = await service.login({ email: 'alice@test.com' });

      expect(result.message).toBe(
        'Your email is not verified yet. We have sent a verification email.',
      );
      expect(result.email).toBe('alice@test.com');
      expect(result.loginSessionId).toBeDefined();
      expect(db.delete).not.toHaveBeenCalled();
      expect(db.insert).toHaveBeenCalled();
      expect(redisService.set).toHaveBeenCalledWith(
        expect.stringContaining('im:login_session:'),
        expect.stringContaining('"status":"pending"'),
        1800,
      );
    });

    it('should send login link for verified human user', async () => {
      db.limit.mockResolvedValue([USER_ROW]);

      const result = await service.login({ email: 'alice@test.com' });

      expect(result.message).toBe('Login link has been sent to your email.');
      expect(result.email).toBe('alice@test.com');
      expect(result.loginSessionId).toBeDefined();
      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(db.insert).toHaveBeenCalled();
      expect(redisService.set).toHaveBeenCalledWith(
        expect.stringContaining('im:login_rate:alice@test.com'),
        '1',
        60,
      );
      expect(redisService.set).toHaveBeenCalledWith(
        expect.stringContaining('im:login_session:'),
        expect.stringContaining('"status":"pending"'),
        1800,
      );
    });

    it('should send the login email when dev email skipping is disabled', async () => {
      process.env.DEV_SKIP_EMAIL_VERIFICATION = 'false';
      db.limit.mockResolvedValue([USER_ROW]);

      const result = await service.login({ email: 'alice@test.com' });

      expect(result.message).toBe('Login link has been sent to your email.');
      expect(result).not.toHaveProperty('verificationLink');
      expect(emailService.sendLoginEmail).toHaveBeenCalledWith(
        USER_ROW.email,
        USER_ROW.username,
        expect.stringContaining('https://app.test/verify-email?token='),
      );
    });
  });

  // ── resendVerificationEmail ──────────────────────────────────────

  describe('resendVerificationEmail', () => {
    it('should enforce resend rate limits', async () => {
      redisService.get.mockResolvedValueOnce('1');

      await expect(
        service.resendVerificationEmail('alice@test.com'),
      ).rejects.toThrow(BadRequestException);

      expect(db.limit).not.toHaveBeenCalled();
    });

    it("should return a generic success response when the account doesn't exist", async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(
        service.resendVerificationEmail('missing@test.com'),
      ).resolves.toEqual({
        message: 'If the email exists, a verification email has been sent.',
        loginSessionId: '',
      });

      expect(db.delete).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('should reject resend requests for already-verified users', async () => {
      db.limit.mockResolvedValueOnce([USER_ROW]);

      await expect(
        service.resendVerificationEmail('alice@test.com'),
      ).rejects.toThrow('Email is already verified');
    });

    it('should replace tokens, issue a new login session, and return the dev verification link', async () => {
      const unverifiedUser = { ...USER_ROW, emailVerified: false };
      db.limit.mockResolvedValueOnce([unverifiedUser]);

      const result = await service.resendVerificationEmail('alice@test.com');

      expect(result.message).toBe('Verification email has been sent.');
      expect(result.loginSessionId).toBeDefined();
      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(redisService.set).toHaveBeenCalledWith(
        'im:verify_rate:alice@test.com',
        '1',
        60,
      );
      expect(redisService.set).toHaveBeenCalledWith(
        expect.stringContaining('im:login_session:'),
        expect.stringContaining('"status":"pending"'),
        1800,
      );
    });
  });

  // ── googleLogin ──────────────────────────────────────────────────

  describe('googleLogin', () => {
    beforeEach(() => {
      process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    });

    it('should reject when google login is not configured', async () => {
      process.env.GOOGLE_CLIENT_ID = '';

      await expect(
        service.googleLogin({ credential: 'google-credential' }),
      ).rejects.toThrow('Google login is not configured');
    });

    it('should reject invalid google credentials', async () => {
      jest
        .spyOn(OAuth2Client.prototype, 'verifyIdToken')
        .mockRejectedValueOnce(new Error('bad credential'));

      await expect(
        service.googleLogin({ credential: 'google-credential' }),
      ).rejects.toThrow('Invalid Google credential');
    });

    it('should reject google payloads without an email', async () => {
      jest
        .spyOn(OAuth2Client.prototype, 'verifyIdToken')
        .mockResolvedValueOnce({
          getPayload: () => ({ name: 'Alice' }),
        } as Awaited<ReturnType<OAuth2Client['verifyIdToken']>>);

      await expect(
        service.googleLogin({ credential: 'google-credential' }),
      ).rejects.toThrow('Invalid Google credential');
    });

    it('should mark existing human users as verified before returning tokens', async () => {
      const existingUser = {
        ...USER_ROW,
        emailVerified: false,
      };
      db.limit.mockResolvedValueOnce([existingUser]);
      jest
        .spyOn(OAuth2Client.prototype, 'verifyIdToken')
        .mockResolvedValueOnce({
          getPayload: () => ({
            email: existingUser.email,
            name: 'Alice',
            picture: 'https://avatar.test/alice.png',
          }),
        } as Awaited<ReturnType<OAuth2Client['verifyIdToken']>>);

      const result = await service.googleLogin({
        credential: 'google-credential',
      });

      expect(result.user.email).toBe(existingUser.email);
      expect(db.update).toHaveBeenCalledTimes(1);
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          emailVerified: true,
          emailVerifiedAt: expect.any(Date),
          updatedAt: expect.any(Date),
        }),
      );
    });

    it('should register new google users and emit lifecycle events', async () => {
      const insertedUser = {
        ...USER_ROW,
        id: 'google-user-id',
        email: 'new-google@test.com',
        username: 'new_google',
        displayName: 'New Google',
        avatarUrl: 'https://avatar.test/new-google.png',
      };
      db.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([insertedUser]);
      jest
        .spyOn(OAuth2Client.prototype, 'verifyIdToken')
        .mockResolvedValueOnce({
          getPayload: () => ({
            email: insertedUser.email,
            name: insertedUser.displayName,
            picture: insertedUser.avatarUrl,
          }),
        } as Awaited<ReturnType<OAuth2Client['verifyIdToken']>>);

      const result = await service.googleLogin({
        credential: 'google-credential',
      });

      expect(result.user).toEqual({
        id: insertedUser.id,
        email: insertedUser.email,
        username: insertedUser.username,
        displayName: insertedUser.displayName,
        avatarUrl: insertedUser.avatarUrl,
      });
      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenNthCalledWith(
        1,
        USER_EVENTS.REGISTERED,
        expect.objectContaining({
          userId: insertedUser.id,
          displayName: insertedUser.displayName,
        }),
      );
      expect(eventEmitter.emit).toHaveBeenNthCalledWith(2, 'user.created', {
        user: insertedUser,
      });
    });

    it('should reject existing non-human google users', async () => {
      db.limit.mockResolvedValueOnce([{ ...USER_ROW, userType: 'bot' }]);
      jest
        .spyOn(OAuth2Client.prototype, 'verifyIdToken')
        .mockResolvedValueOnce({
          getPayload: () => ({
            email: USER_ROW.email,
            name: 'Alice',
          }),
        } as Awaited<ReturnType<OAuth2Client['verifyIdToken']>>);

      await expect(
        service.googleLogin({ credential: 'google-credential' }),
      ).rejects.toThrow('This account cannot log in');
    });

    it('should reject existing inactive google users', async () => {
      db.limit.mockResolvedValueOnce([{ ...USER_ROW, isActive: false }]);
      jest
        .spyOn(OAuth2Client.prototype, 'verifyIdToken')
        .mockResolvedValueOnce({
          getPayload: () => ({
            email: USER_ROW.email,
            name: 'Alice',
          }),
        } as Awaited<ReturnType<OAuth2Client['verifyIdToken']>>);

      await expect(
        service.googleLogin({ credential: 'google-credential' }),
      ).rejects.toThrow('Account is disabled');
    });
  });

  // ── verifyEmail ──────────────────────────────────────────────────

  describe('verifyEmail', () => {
    it('should verify email, consume linked login session, and return tokens', async () => {
      const tokenRecord = {
        id: 'token-1',
        userId: USER_ROW.id,
        token: 'token-123',
        email: USER_ROW.email,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      };
      const verifiedUser = {
        ...USER_ROW,
        emailVerified: true,
        emailVerifiedAt: new Date(),
        updatedAt: new Date(),
      };

      db.limit.mockResolvedValueOnce([tokenRecord]);
      db.returning.mockResolvedValueOnce([verifiedUser]);
      redisService.get.mockResolvedValue('login-session-1');

      const result = await service.verifyEmail('token-123');

      expect(result.user.email).toBe('alice@test.com');
      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBe('mock-refresh-token');
      expect(db.set).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ usedAt: expect.any(Date) }),
      );
      expect(db.set).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          emailVerified: true,
          emailVerifiedAt: expect.any(Date),
          updatedAt: expect.any(Date),
        }),
      );
      expect(redisService.set).toHaveBeenCalledWith(
        'im:login_session:login-session-1',
        expect.stringContaining('"status":"verified"'),
        300,
      );
      expect(redisService.del).toHaveBeenCalledWith(
        'im:login_session_by_user:user-uuid',
      );
    });

    it('should verify email without an associated login session', async () => {
      const tokenRecord = {
        id: 'token-1',
        userId: USER_ROW.id,
        token: 'token-123',
        email: USER_ROW.email,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      };
      const verifiedUser = {
        ...USER_ROW,
        emailVerified: true,
        emailVerifiedAt: new Date(),
        updatedAt: new Date(),
      };

      db.limit.mockResolvedValueOnce([tokenRecord]);
      db.returning.mockResolvedValueOnce([verifiedUser]);
      redisService.get.mockResolvedValueOnce(null);

      const result = await service.verifyEmail('token-123');

      expect(result.user.email).toBe('alice@test.com');
      expect(redisService.set).not.toHaveBeenCalledWith(
        expect.stringContaining('im:login_session:'),
        expect.any(String),
        300,
      );
      expect(redisService.del).not.toHaveBeenCalled();
    });

    it('should reject missing verification tokens', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(service.verifyEmail('missing-token')).rejects.toThrow(
        'Invalid verification token',
      );
    });

    it('should reject already-used verification tokens', async () => {
      const tokenRecord = {
        id: 'token-1',
        userId: USER_ROW.id,
        token: 'token-123',
        email: USER_ROW.email,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
      };

      db.limit.mockResolvedValueOnce([tokenRecord]);

      await expect(service.verifyEmail('token-123')).rejects.toThrow(
        'Verification token has already been used',
      );
    });

    it('should reject expired verification tokens', async () => {
      const tokenRecord = {
        id: 'token-1',
        userId: USER_ROW.id,
        token: 'token-123',
        email: USER_ROW.email,
        expiresAt: new Date(Date.now() - 60_000),
        usedAt: null,
      };

      db.limit.mockResolvedValueOnce([tokenRecord]);

      await expect(service.verifyEmail('token-123')).rejects.toThrow(
        'Verification token has expired',
      );
    });
  });

  // ── refreshToken / logout ────────────────────────────────────────

  describe('refreshToken and logout', () => {
    it('should reject revoked refresh tokens', async () => {
      jwtService.verify.mockReturnValueOnce({
        sub: USER_ROW.id,
        jti: 'refresh-jti-2',
        exp: Math.floor(Date.now() / 1000) + 120,
      });
      redisService.get.mockResolvedValueOnce('1');

      await expect(service.refreshToken('revoked-token')).rejects.toThrow(
        'Invalid refresh token',
      );
      expect(db.limit).not.toHaveBeenCalled();
      expect(redisService.set).not.toHaveBeenCalled();
    });

    it('should reject refresh tokens when the user no longer exists', async () => {
      jwtService.verify.mockReturnValueOnce({
        sub: 'missing-user',
        jti: 'refresh-jti-3',
        exp: Math.floor(Date.now() / 1000) + 120,
      });
      redisService.get.mockResolvedValueOnce(null);
      db.limit.mockResolvedValueOnce([]);

      await expect(service.refreshToken('stale-token')).rejects.toThrow(
        'Invalid refresh token',
      );
      expect(redisService.set).not.toHaveBeenCalled();
    });

    it('should ignore invalid refresh tokens during logout', async () => {
      jwtService.verify.mockImplementationOnce(() => {
        throw new Error('invalid');
      });

      await expect(
        service.logout(USER_ROW.id, 'bad-token'),
      ).resolves.toBeUndefined();

      expect(redisService.set).not.toHaveBeenCalled();
    });

    it('should do nothing when logout is called without a refresh token', async () => {
      await expect(service.logout(USER_ROW.id)).resolves.toBeUndefined();

      expect(jwtService.verify).not.toHaveBeenCalled();
      expect(redisService.set).not.toHaveBeenCalled();
    });
  });

  // ── createDesktopSession ──────────────────────────────────────────

  describe('createDesktopSession', () => {
    it('should create a session', async () => {
      const result = await service.createDesktopSession('127.0.0.1');

      expect(result.sessionId).toBeDefined();
      expect(result.expiresInSeconds).toBe(1800);
      // Should store session in Redis
      expect(redisService.set).toHaveBeenCalledWith(
        expect.stringContaining('im:login_session:'),
        expect.stringContaining('"status":"pending"'),
        1800,
      );
    });

    it('should enforce IP rate limiting', async () => {
      redisService.incr.mockResolvedValue(11); // over limit

      await expect(service.createDesktopSession('127.0.0.1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── completeDesktopSession ────────────────────────────────────────

  describe('completeDesktopSession', () => {
    it('should complete pending session', async () => {
      const session = { status: 'pending' };
      redisService.get.mockResolvedValue(JSON.stringify(session));
      db.limit.mockResolvedValue([USER_ROW]);

      const result = await service.completeDesktopSession(
        { sessionId: 'session-1' },
        'user-uuid',
      );

      expect(result.success).toBe(true);
      // Should store verified result with tokens
      expect(redisService.set).toHaveBeenCalledWith(
        expect.stringContaining('im:login_session:'),
        expect.stringContaining('"status":"verified"'),
        300,
      );
    });

    it('should reject expired/missing session', async () => {
      redisService.get.mockResolvedValue(null);

      await expect(
        service.completeDesktopSession({ sessionId: 'gone' }, 'user-uuid'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject already-used session', async () => {
      const session = { status: 'verified' };
      redisService.get.mockResolvedValue(JSON.stringify(session));

      await expect(
        service.completeDesktopSession({ sessionId: 'session-1' }, 'user-uuid'),
      ).rejects.toThrow('Desktop session has already been used');
    });

    it('should reject if user not found', async () => {
      const session = { status: 'pending' };
      redisService.get.mockResolvedValue(JSON.stringify(session));
      db.limit.mockResolvedValue([]); // user not found

      await expect(
        service.completeDesktopSession({ sessionId: 'session-1' }, 'user-uuid'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── generateUniqueUsername ───────────────────────────────────────

  describe('generateUniqueUsername', () => {
    const callGenerate = (input: string, email?: string) =>
      (service as any).generateUniqueUsername(input, email);

    it('should transliterate Chinese characters', async () => {
      db.limit.mockResolvedValue([]); // no collision
      const result = await callGenerate('张三', 'zhangsan@test.com');
      expect(result).toBe('zhang_san');
    });

    it('should handle Latin input directly', async () => {
      db.limit.mockResolvedValue([]);
      const result = await callGenerate('Alice Smith');
      expect(result).toBe('alice_smith');
    });

    it('should fall back to email prefix when transliteration produces < 3 chars', async () => {
      db.limit.mockResolvedValue([]);
      // Single rare character that may not transliterate well
      const result = await callGenerate('꧁꧂', 'cooluser@test.com');
      expect(result).toBe('cooluser');
    });

    it('should extract email prefix when input is an email', async () => {
      db.limit.mockResolvedValue([]);
      const result = await callGenerate('user@example.com');
      expect(result).toBe('user');
    });

    it('should append random suffix on collision', async () => {
      // First call: base check → collision. Second call: suffixed → no collision
      let callCount = 0;
      db.limit.mockImplementation((() => {
        callCount++;
        if (callCount === 1) return Promise.resolve([USER_ROW]); // collision
        return Promise.resolve([]); // no collision
      }) as any);

      const result = await callGenerate('alice');
      expect(result).toMatch(/^alice_\d{4}$/);
    });

    it('should pad to minimum 3 characters', async () => {
      db.limit.mockResolvedValue([]);
      const result = await callGenerate('ab');
      expect(result.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ── pollLogin ─────────────────────────────────────────────────────

  describe('pollLogin', () => {
    it('should return pending status', async () => {
      redisService.get.mockResolvedValue(JSON.stringify({ status: 'pending' }));

      const result = await service.pollLogin('session-1', '127.0.0.1');

      expect(result.status).toBe('pending');
    });

    it('should consume verified session (one-time read)', async () => {
      const verifiedData = {
        status: 'verified',
        accessToken: 'at',
        refreshToken: 'rt',
        user: USER_ROW,
      };
      redisService.get.mockResolvedValue(JSON.stringify(verifiedData));

      const result = await service.pollLogin('session-1', '127.0.0.1');

      expect(result.status).toBe('verified');
      expect(redisService.del).toHaveBeenCalledWith(
        'im:login_session:session-1',
      );
    });

    it('should throw on missing session', async () => {
      redisService.get.mockResolvedValue(null);

      await expect(service.pollLogin('gone', '127.0.0.1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should enforce rate limiting', async () => {
      redisService.incr.mockResolvedValue(31); // over limit

      await expect(service.pollLogin('session-1', '127.0.0.1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── getUserById / cleanupExpiredTokens ───────────────────────────

  describe('getUserById', () => {
    it('should serialize the found user', async () => {
      db.limit.mockResolvedValueOnce([USER_ROW]);

      await expect(service.getUserById(USER_ROW.id)).resolves.toEqual({
        id: USER_ROW.id,
        email: USER_ROW.email,
        username: USER_ROW.username,
        displayName: USER_ROW.displayName,
        avatarUrl: USER_ROW.avatarUrl,
        isActive: USER_ROW.isActive,
        createdAt: USER_ROW.createdAt.toISOString(),
        updatedAt: USER_ROW.updatedAt.toISOString(),
      });
    });

    it('should reject when the user cannot be found', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(service.getUserById('missing-user')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('getUserByClaims', () => {
    it('should resolve a user by username when sub-based lookup has drifted', async () => {
      db.limit.mockResolvedValueOnce([USER_ROW]);

      await expect(
        service.getUserByClaims({
          email: 'other@test.com',
          username: USER_ROW.username,
        }),
      ).resolves.toEqual({
        id: USER_ROW.id,
        email: USER_ROW.email,
        username: USER_ROW.username,
        displayName: USER_ROW.displayName,
        avatarUrl: USER_ROW.avatarUrl,
        isActive: USER_ROW.isActive,
        createdAt: USER_ROW.createdAt.toISOString(),
        updatedAt: USER_ROW.updatedAt.toISOString(),
      });
    });

    it('should fall back to email when username does not resolve', async () => {
      db.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([USER_ROW]);

      await expect(
        service.getUserByClaims({
          email: USER_ROW.email,
          username: 'missing-username',
        }),
      ).resolves.toEqual({
        id: USER_ROW.id,
        email: USER_ROW.email,
        username: USER_ROW.username,
        displayName: USER_ROW.displayName,
        avatarUrl: USER_ROW.avatarUrl,
        isActive: USER_ROW.isActive,
        createdAt: USER_ROW.createdAt.toISOString(),
        updatedAt: USER_ROW.updatedAt.toISOString(),
      });
    });

    it('should reject when neither username nor email resolves', async () => {
      db.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      await expect(
        service.getUserByClaims({
          email: 'missing@test.com',
          username: 'missing-username',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should delete expired verification tokens', async () => {
      await expect(service.cleanupExpiredTokens()).resolves.toBeUndefined();

      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(db.where).toHaveBeenCalledTimes(1);
    });
  });
});
