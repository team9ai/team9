import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { AuthService } from './auth.service.js';
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

  beforeEach(async () => {
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
});
