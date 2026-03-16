import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OAuth2Client } from 'google-auth-library';
import * as crypto from 'crypto';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  lt,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { RedisService } from '@team9/redis';
import { EmailService } from '@team9/email';
import { env } from '@team9/shared';
import type { JwtPayload } from '@team9/auth';
import { slugify } from 'transliteration';
import {
  RegisterDto,
  LoginDto,
  GoogleLoginDto,
  AuthStartDto,
  VerifyCodeDto,
  CompleteDesktopSessionDto,
} from './dto/index.js';
import { USER_EVENTS, type UserRegisteredEvent } from './events/user.events.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse extends TokenPair {
  user: {
    id: string;
    email: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

export interface RegisterResponse {
  message: string;
  email: string;
  loginSessionId: string;
  /** Verification link returned in dev mode when DEV_SKIP_EMAIL_VERIFICATION=true */
  verificationLink?: string;
}

export interface LoginResponse {
  message: string;
  email: string;
  loginSessionId: string;
  /** Verification link returned in dev mode when DEV_SKIP_EMAIL_VERIFICATION=true */
  verificationLink?: string;
}

export interface AuthStartResponse {
  action: 'code_sent' | 'need_display_name';
  email: string;
  challengeId?: string;
  expiresInSeconds?: number;
  /** Verification code returned in dev mode when DEV_SKIP_EMAIL_VERIFICATION=true */
  verificationCode?: string;
}

export interface DesktopSessionResponse {
  sessionId: string;
  expiresInSeconds: number;
}

interface AuthChallenge {
  status: 'pending' | 'verified' | 'failed';
  email: string;
  codeHash: string;
  attemptsRemaining: number;
  flow: 'login' | 'verify_existing_user' | 'signup';
  signupDisplayName?: string;
}

@Injectable()
export class AuthService {
  private readonly TOKEN_BLACKLIST_PREFIX = 'im:token_blacklist:';
  private readonly VERIFICATION_RATE_LIMIT_PREFIX = 'im:verify_rate:';
  private readonly LOGIN_RATE_LIMIT_PREFIX = 'im:login_rate:';
  private readonly VERIFICATION_TOKEN_EXPIRY_HOURS = 24;
  private readonly LOGIN_SESSION_PREFIX = 'im:login_session:';
  private readonly LOGIN_SESSION_BY_USER_PREFIX = 'im:login_session_by_user:';
  private readonly LOGIN_SESSION_TTL = 1800; // 30 minutes
  private readonly LOGIN_SESSION_RESULT_TTL = 300; // 5 minutes
  private readonly POLL_LOGIN_RATE_PREFIX = 'im:poll_login_rate:';
  private readonly POLL_LOGIN_RATE_LIMIT = 30; // max requests per minute
  private readonly POLL_LOGIN_RATE_TTL = 60; // 60 seconds
  private readonly AUTH_CHALLENGE_PREFIX = 'im:auth_challenge:';
  private readonly AUTH_CHALLENGE_TTL = 600; // 10 minutes
  private readonly AUTH_CHALLENGE_MAX_ATTEMPTS = 5;
  private readonly DESKTOP_SESSION_RATE_PREFIX = 'im:desktop_session_rate:';
  private readonly DESKTOP_SESSION_RATE_LIMIT = 10; // max 10 sessions per minute per IP
  private readonly DESKTOP_SESSION_RATE_TTL = 60;

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
    private readonly emailService: EmailService,
  ) {}

  async register(dto: RegisterDto): Promise<RegisterResponse> {
    // Check if email or username already exists
    const existingUser = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, dto.email))
      .limit(1);

    if (existingUser.length > 0) {
      const user = existingUser[0];
      if (user.emailVerified) {
        throw new ConflictException(
          'Email already registered. Please sign in instead.',
        );
      }
      // Email exists but not verified — resend verification email
      await this.db
        .delete(schema.emailVerificationTokens)
        .where(eq(schema.emailVerificationTokens.userId, user.id));

      const { verificationLink } = await this.sendVerificationEmail(
        user.id,
        user.email,
        user.username,
      );

      const loginSessionId = await this.createLoginSession(user.id);

      return {
        message:
          'Registration successful. Please check your email to verify your account.',
        email: user.email,
        loginSessionId,
        ...(env.DEV_SKIP_EMAIL_VERIFICATION && { verificationLink }),
      };
    }

    const existingUsername = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, dto.username))
      .limit(1);

    if (existingUsername.length > 0) {
      throw new ConflictException('Username already exists');
    }

    const userId = uuidv7();

    // Create user without password
    const [user] = await this.db
      .insert(schema.users)
      .values({
        id: userId,
        email: dto.email,
        username: dto.username,
        displayName: dto.displayName || dto.username,
        emailVerified: false,
      })
      .returning();

    // Emit event to create a personal workspace for the user
    this.eventEmitter.emit(USER_EVENTS.REGISTERED, {
      userId: user.id,
      displayName: dto.displayName || dto.username,
    } satisfies UserRegisteredEvent);

    // Emit event for search indexing
    this.eventEmitter.emit('user.created', { user });

    // Generate and send verification email (returns link, may skip email in dev mode)
    const { verificationLink } = await this.sendVerificationEmail(
      user.id,
      user.email,
      user.username,
    );

    const loginSessionId = await this.createLoginSession(user.id);

    return {
      message:
        'Registration successful. Please check your email to verify your account.',
      email: user.email,
      loginSessionId,
      // Include verification link in dev mode for easy testing
      ...(env.DEV_SKIP_EMAIL_VERIFICATION && { verificationLink }),
    };
  }

  private async sendVerificationEmail(
    userId: string,
    email: string,
    username: string,
  ): Promise<{ verificationLink: string }> {
    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(
      Date.now() + this.VERIFICATION_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000,
    );

    // Store token in database
    await this.db.insert(schema.emailVerificationTokens).values({
      id: uuidv7(),
      userId,
      token,
      email,
      expiresAt,
    });

    // Build verification link
    const verificationLink = `${env.APP_URL}/verify-email?token=${token}`;

    // In dev mode with skip verification, don't send email
    if (!env.DEV_SKIP_EMAIL_VERIFICATION) {
      await this.emailService.sendVerificationEmail(
        email,
        username,
        verificationLink,
      );
    }

    return { verificationLink };
  }

  private async sendLoginLink(
    userId: string,
    email: string,
    username: string,
  ): Promise<{ verificationLink: string }> {
    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(
      Date.now() + this.VERIFICATION_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000,
    );

    // Store token in database (reuse email verification tokens table)
    await this.db.insert(schema.emailVerificationTokens).values({
      id: uuidv7(),
      userId,
      token,
      email,
      expiresAt,
    });

    // Build login link
    const verificationLink = `${env.APP_URL}/verify-email?token=${token}`;

    // In dev mode with skip verification, don't send email
    if (!env.DEV_SKIP_EMAIL_VERIFICATION) {
      await this.emailService.sendLoginEmail(email, username, verificationLink);
    }

    return { verificationLink };
  }

  async verifyEmail(token: string): Promise<AuthResponse> {
    // Find valid token
    const [tokenRecord] = await this.db
      .select()
      .from(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.token, token))
      .limit(1);

    if (!tokenRecord) {
      throw new BadRequestException('Invalid verification token');
    }

    if (tokenRecord.usedAt) {
      throw new BadRequestException('Verification token has already been used');
    }

    if (new Date() > tokenRecord.expiresAt) {
      throw new BadRequestException('Verification token has expired');
    }

    // Mark token as used
    await this.db
      .update(schema.emailVerificationTokens)
      .set({ usedAt: new Date() })
      .where(eq(schema.emailVerificationTokens.id, tokenRecord.id));

    // Update user emailVerified status
    const [user] = await this.db
      .update(schema.users)
      .set({
        emailVerified: true,
        emailVerifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, tokenRecord.userId))
      .returning();

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.userType !== 'human') {
      throw new UnauthorizedException('This account cannot authenticate');
    }

    // Generate tokens and return AuthResponse
    const tokens = this.generateTokenPair(user);

    // Write auth result to login session (enables polling-based login for desktop)
    const sessionId = await this.redisService.get(
      `${this.LOGIN_SESSION_BY_USER_PREFIX}${user.id}`,
    );
    if (sessionId) {
      await this.redisService.set(
        `${this.LOGIN_SESSION_PREFIX}${sessionId}`,
        JSON.stringify({
          status: 'verified',
          ...tokens,
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
          },
        }),
        this.LOGIN_SESSION_RESULT_TTL,
      );
      await this.redisService.del(
        `${this.LOGIN_SESSION_BY_USER_PREFIX}${user.id}`,
      );
    }

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  async resendVerificationEmail(email: string): Promise<{
    message: string;
    loginSessionId: string;
    verificationLink?: string;
  }> {
    // Rate limiting check using Redis
    const rateLimitKey = `${this.VERIFICATION_RATE_LIMIT_PREFIX}${email}`;
    const recentAttempt = await this.redisService.get(rateLimitKey);

    if (recentAttempt) {
      throw new BadRequestException(
        'Please wait before requesting another verification email',
      );
    }

    // Find user
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (!user) {
      // Return success even if user doesn't exist (security - don't reveal user existence)
      return {
        message: 'If the email exists, a verification email has been sent.',
        loginSessionId: '',
      };
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    // Delete existing tokens for this user
    await this.db
      .delete(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.userId, user.id));

    // Send new verification email
    const { verificationLink } = await this.sendVerificationEmail(
      user.id,
      user.email,
      user.username,
    );

    // Set rate limit (60 seconds)
    await this.redisService.set(rateLimitKey, '1', 60);

    const loginSessionId = await this.createLoginSession(user.id);

    return {
      message: 'Verification email has been sent.',
      loginSessionId,
      // Include verification link in dev mode for easy testing
      ...(env.DEV_SKIP_EMAIL_VERIFICATION && { verificationLink }),
    };
  }

  async login(dto: LoginDto): Promise<LoginResponse> {
    // Rate limiting check using Redis
    const rateLimitKey = `${this.LOGIN_RATE_LIMIT_PREFIX}${dto.email}`;
    const recentAttempt = await this.redisService.get(rateLimitKey);

    if (recentAttempt) {
      throw new BadRequestException(
        'Please wait before requesting another login link',
      );
    }

    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, dto.email))
      .limit(1);

    if (!user) {
      throw new NotFoundException(
        'No account found with this email. Please register first.',
      );
    }

    if (user.userType !== 'human') {
      throw new UnauthorizedException('This account cannot log in');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }

    if (!user.emailVerified) {
      // If email not verified, send verification email instead
      const { verificationLink } = await this.sendVerificationEmail(
        user.id,
        user.email,
        user.username,
      );
      const loginSessionId = await this.createLoginSession(user.id);
      return {
        message:
          'Your email is not verified yet. We have sent a verification email.',
        email: dto.email,
        loginSessionId,
        // Include verification link in dev mode for easy testing
        ...(env.DEV_SKIP_EMAIL_VERIFICATION && { verificationLink }),
      };
    }

    // Delete existing login tokens for this user
    await this.db
      .delete(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.userId, user.id));

    // Send login link
    const { verificationLink } = await this.sendLoginLink(
      user.id,
      user.email,
      user.username,
    );

    // Set rate limit (60 seconds)
    await this.redisService.set(rateLimitKey, '1', 60);

    const loginSessionId = await this.createLoginSession(user.id);

    return {
      message: 'Login link has been sent to your email.',
      email: dto.email,
      loginSessionId,
      // Include verification link in dev mode for easy testing
      ...(env.DEV_SKIP_EMAIL_VERIFICATION && { verificationLink }),
    };
  }

  async googleLogin(dto: GoogleLoginDto): Promise<AuthResponse> {
    const googleClientId = env.GOOGLE_CLIENT_ID;
    if (!googleClientId) {
      throw new BadRequestException('Google login is not configured');
    }

    // Verify Google ID token
    const client = new OAuth2Client(googleClientId);
    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken: dto.credential,
        audience: googleClientId,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google credential');
    }

    if (!payload || !payload.email) {
      throw new UnauthorizedException('Invalid Google credential');
    }

    const { email, name, picture } = payload;

    // Check if user already exists
    const [existingUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (existingUser) {
      // Existing user — login directly
      if (existingUser.userType !== 'human') {
        throw new UnauthorizedException('This account cannot log in');
      }
      if (!existingUser.isActive) {
        throw new UnauthorizedException('Account is disabled');
      }

      // Mark email as verified if not already (Google login = verified email)
      if (!existingUser.emailVerified) {
        await this.db
          .update(schema.users)
          .set({
            emailVerified: true,
            emailVerifiedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.users.id, existingUser.id));
      }

      const tokens = this.generateTokenPair(existingUser);
      return {
        ...tokens,
        user: {
          id: existingUser.id,
          email: existingUser.email,
          username: existingUser.username,
          displayName: existingUser.displayName,
          avatarUrl: existingUser.avatarUrl,
        },
      };
    }

    // New user — auto-register (prefer Google display name for username)
    const username = await this.generateUniqueUsername(name || email, email);
    const userId = uuidv7();

    const [user] = await this.db
      .insert(schema.users)
      .values({
        id: userId,
        email,
        username,
        displayName: name || username,
        avatarUrl: picture || null,
        emailVerified: true,
        emailVerifiedAt: new Date(),
      })
      .returning();

    // Emit events (same as register flow)
    this.eventEmitter.emit(USER_EVENTS.REGISTERED, {
      userId: user.id,
      displayName: name || username,
    } satisfies UserRegisteredEvent);

    this.eventEmitter.emit('user.created', { user });

    const tokens = this.generateTokenPair(user);
    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  private async generateUniqueUsername(
    input: string,
    email?: string,
  ): Promise<string> {
    // If input looks like an email, use the prefix; otherwise transliterate and slugify
    const raw = input.includes('@') ? input.split('@')[0] : input;
    let base = slugify(raw, { separator: '_', lowercase: true })
      .replace(/[^a-z0-9_]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    // If transliteration produced nothing useful, fall back to email prefix
    if (base.length < 3 && email) {
      const emailPrefix = email.split('@')[0];
      base = emailPrefix
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    }

    // Ensure minimum 3 characters
    if (base.length < 3) {
      base = base.padEnd(3, '_');
    }

    // Truncate to 26 chars to leave room for suffix
    base = base.slice(0, 26);

    // Check if username is available
    const [existing] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, base))
      .limit(1);

    if (!existing) {
      return base;
    }

    // Collision — append _XXXX random suffix, retry up to 5 times
    for (let i = 0; i < 5; i++) {
      const suffix = Math.floor(1000 + Math.random() * 9000).toString();
      const candidate = `${base}_${suffix}`;
      const [conflict] = await this.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, candidate))
        .limit(1);
      if (!conflict) {
        return candidate;
      }
    }

    // Fallback: use uuid fragment
    return `${base}_${uuidv7().slice(-4)}`;
  }

  async refreshToken(refreshToken: string): Promise<TokenPair> {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        publicKey: env.JWT_REFRESH_PUBLIC_KEY,
        algorithms: ['ES256'],
      });

      // Check if token is blacklisted
      const isBlacklisted = await this.redisService.get(
        `${this.TOKEN_BLACKLIST_PREFIX}${payload.jti}`,
      );

      if (isBlacklisted) {
        throw new UnauthorizedException('Token has been revoked');
      }

      // Get user
      const [user] = await this.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, payload.sub))
        .limit(1);

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      if (user.userType !== 'human') {
        throw new UnauthorizedException('This account cannot refresh tokens');
      }

      // Blacklist old refresh token (TTL = remaining time until expiry)
      const ttl = payload.exp! - Math.floor(Date.now() / 1000) + 1;
      if (ttl > 0) {
        await this.redisService.set(
          `${this.TOKEN_BLACKLIST_PREFIX}${payload.jti}`,
          '1',
          ttl,
        );
      }

      // Generate new tokens
      return this.generateTokenPair(user);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(_userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      try {
        const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
          publicKey: env.JWT_REFRESH_PUBLIC_KEY,
          algorithms: ['ES256'],
        });
        const ttl = payload.exp! - Math.floor(Date.now() / 1000);
        if (ttl > 0) {
          await this.redisService.set(
            `${this.TOKEN_BLACKLIST_PREFIX}${payload.jti}`,
            '1',
            ttl,
          );
        }
      } catch {
        // Token already invalid, ignore
      }
    }
  }

  private generateTokenPair(user: {
    id: string;
    email: string;
    username: string;
  }): TokenPair {
    const basePayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
    };

    const accessToken = this.jwtService.sign(
      { ...basePayload, jti: uuidv7() },
      {
        privateKey: env.JWT_PRIVATE_KEY,
        algorithm: 'ES256',
        expiresIn: env.JWT_EXPIRES_IN as any,
      },
    );

    const refreshToken = this.jwtService.sign(
      { ...basePayload, jti: uuidv7() },
      {
        privateKey: env.JWT_REFRESH_PRIVATE_KEY,
        algorithm: 'ES256',
        expiresIn: env.JWT_REFRESH_EXPIRES_IN as any,
      },
    );

    return { accessToken, refreshToken };
  }

  verifyToken(token: string): JwtPayload {
    return this.jwtService.verify<JwtPayload>(token, {
      publicKey: env.JWT_PUBLIC_KEY,
      algorithms: ['ES256'],
    });
  }

  async getUserById(userId: string) {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  async createLoginSession(userId: string): Promise<string> {
    const sessionId = crypto.randomBytes(16).toString('hex');
    await this.redisService.set(
      `${this.LOGIN_SESSION_PREFIX}${sessionId}`,
      JSON.stringify({ status: 'pending' }),
      this.LOGIN_SESSION_TTL,
    );
    await this.redisService.set(
      `${this.LOGIN_SESSION_BY_USER_PREFIX}${userId}`,
      sessionId,
      this.LOGIN_SESSION_TTL,
    );
    return sessionId;
  }

  async pollLogin(sessionId: string, ip: string) {
    // IP-based rate limiting: max 30 requests per minute
    const rateLimitKey = `${this.POLL_LOGIN_RATE_PREFIX}${ip}`;
    const count = await this.redisService.incr(rateLimitKey);
    if (count === 1) {
      await this.redisService.expire(rateLimitKey, this.POLL_LOGIN_RATE_TTL);
    }
    if (count > this.POLL_LOGIN_RATE_LIMIT) {
      throw new BadRequestException(
        'Too many poll requests. Please slow down.',
      );
    }

    const data = await this.redisService.get(
      `${this.LOGIN_SESSION_PREFIX}${sessionId}`,
    );
    if (!data) {
      throw new NotFoundException('Login session not found or expired');
    }
    const result = JSON.parse(data);

    // One-time consumption: delete key after returning verified result
    if (result.status === 'verified') {
      await this.redisService.del(`${this.LOGIN_SESSION_PREFIX}${sessionId}`);
    }

    return result;
  }

  // --- New code-based auth flow ---

  async authStart(dto: AuthStartDto): Promise<AuthStartResponse> {
    // Rate limiting
    const rateLimitKey = `${this.LOGIN_RATE_LIMIT_PREFIX}${dto.email}`;
    const recentAttempt = await this.redisService.get(rateLimitKey);
    if (recentAttempt) {
      throw new BadRequestException(
        'Please wait before requesting another verification code',
      );
    }

    const [existingUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, dto.email))
      .limit(1);

    if (existingUser) {
      // Existing user — check eligibility
      if (existingUser.userType !== 'human') {
        throw new UnauthorizedException('This account cannot log in');
      }
      if (!existingUser.isActive) {
        throw new UnauthorizedException('Account is disabled');
      }

      const flow = existingUser.emailVerified
        ? 'login'
        : 'verify_existing_user';

      const result = await this.createAuthChallenge(dto.email, flow);
      await this.redisService.set(rateLimitKey, '1', 60);

      return {
        action: 'code_sent',
        email: dto.email,
        challengeId: result.challengeId,
        expiresInSeconds: this.AUTH_CHALLENGE_TTL,
        ...(env.DEV_SKIP_EMAIL_VERIFICATION && {
          verificationCode: result.code,
        }),
      };
    }

    // New user — need display name first
    if (!dto.displayName) {
      return {
        action: 'need_display_name',
        email: dto.email,
      };
    }

    // New user with display name — create signup challenge (don't create user yet)
    const result = await this.createAuthChallenge(
      dto.email,
      'signup',
      dto.displayName,
    );
    await this.redisService.set(rateLimitKey, '1', 60);

    return {
      action: 'code_sent',
      email: dto.email,
      challengeId: result.challengeId,
      expiresInSeconds: this.AUTH_CHALLENGE_TTL,
      ...(env.DEV_SKIP_EMAIL_VERIFICATION && {
        verificationCode: result.code,
      }),
    };
  }

  private async createAuthChallenge(
    email: string,
    flow: AuthChallenge['flow'],
    signupDisplayName?: string,
  ): Promise<{ challengeId: string; code: string }> {
    const challengeId = crypto.randomBytes(16).toString('hex');
    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    const challenge: AuthChallenge = {
      status: 'pending',
      email,
      codeHash,
      attemptsRemaining: this.AUTH_CHALLENGE_MAX_ATTEMPTS,
      flow,
      ...(signupDisplayName && { signupDisplayName }),
    };

    await this.redisService.set(
      `${this.AUTH_CHALLENGE_PREFIX}${challengeId}`,
      JSON.stringify(challenge),
      this.AUTH_CHALLENGE_TTL,
    );

    // Send verification code email
    if (!env.DEV_SKIP_EMAIL_VERIFICATION) {
      await this.emailService.sendVerificationCodeEmail(email, code, 10);
    }

    return { challengeId, code };
  }

  async verifyCode(dto: VerifyCodeDto): Promise<AuthResponse> {
    const challengeKey = `${this.AUTH_CHALLENGE_PREFIX}${dto.challengeId}`;
    const raw = await this.redisService.get(challengeKey);

    if (!raw) {
      throw new BadRequestException(
        'Verification challenge not found or expired',
      );
    }

    const challenge: AuthChallenge = JSON.parse(raw);

    if (challenge.status !== 'pending') {
      throw new BadRequestException('Challenge has already been used');
    }

    if (challenge.email !== dto.email) {
      throw new BadRequestException('Email mismatch');
    }

    if (challenge.attemptsRemaining <= 0) {
      throw new BadRequestException(
        'Too many failed attempts. Please request a new code.',
      );
    }

    // Verify code
    const inputHash = crypto
      .createHash('sha256')
      .update(dto.code)
      .digest('hex');
    if (inputHash !== challenge.codeHash) {
      // Decrement attempts
      challenge.attemptsRemaining--;
      if (challenge.attemptsRemaining <= 0) {
        challenge.status = 'failed';
      }
      await this.redisService.set(
        challengeKey,
        JSON.stringify(challenge),
        this.AUTH_CHALLENGE_TTL,
      );
      throw new BadRequestException('Invalid verification code');
    }

    // Code is correct — mark as verified and consume
    challenge.status = 'verified';
    await this.redisService.set(
      challengeKey,
      JSON.stringify(challenge),
      60, // keep briefly for idempotency
    );

    if (challenge.flow === 'signup') {
      // Create user now
      return this.completeSignup(challenge.email, challenge.signupDisplayName!);
    }

    // Login or verify existing user
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, challenge.email))
      .limit(1);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Mark email as verified if needed
    if (challenge.flow === 'verify_existing_user' && !user.emailVerified) {
      await this.db
        .update(schema.users)
        .set({
          emailVerified: true,
          emailVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, user.id));
    }

    const tokens = this.generateTokenPair(user);
    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  private async completeSignup(
    email: string,
    displayName: string,
  ): Promise<AuthResponse> {
    // Double-check email is still available
    const [existing] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (existing) {
      // Race condition: user was created between start and verify-code
      // Just log them in
      const tokens = this.generateTokenPair(existing);
      return {
        ...tokens,
        user: {
          id: existing.id,
          email: existing.email,
          username: existing.username,
          displayName: existing.displayName,
          avatarUrl: existing.avatarUrl,
        },
      };
    }

    const username = await this.generateUniqueUsername(displayName, email);
    const userId = uuidv7();

    const [user] = await this.db
      .insert(schema.users)
      .values({
        id: userId,
        email,
        username,
        displayName,
        emailVerified: true,
        emailVerifiedAt: new Date(),
      })
      .returning();

    this.eventEmitter.emit(USER_EVENTS.REGISTERED, {
      userId: user.id,
      displayName,
    } satisfies UserRegisteredEvent);

    this.eventEmitter.emit('user.created', { user });

    const tokens = this.generateTokenPair(user);
    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  // --- Desktop session ---

  async createDesktopSession(ip: string): Promise<DesktopSessionResponse> {
    // IP-based rate limiting
    const rateLimitKey = `${this.DESKTOP_SESSION_RATE_PREFIX}${ip}`;
    const count = await this.redisService.incr(rateLimitKey);
    if (count === 1) {
      await this.redisService.expire(
        rateLimitKey,
        this.DESKTOP_SESSION_RATE_TTL,
      );
    }
    if (count > this.DESKTOP_SESSION_RATE_LIMIT) {
      throw new BadRequestException(
        'Too many desktop session requests. Please slow down.',
      );
    }

    const sessionId = crypto.randomBytes(16).toString('hex');

    await this.redisService.set(
      `${this.LOGIN_SESSION_PREFIX}${sessionId}`,
      JSON.stringify({ status: 'pending' }),
      this.LOGIN_SESSION_TTL,
    );

    return {
      sessionId,
      expiresInSeconds: this.LOGIN_SESSION_TTL,
    };
  }

  async completeDesktopSession(
    dto: CompleteDesktopSessionDto,
    userId: string,
  ): Promise<{ success: boolean }> {
    const sessionKey = `${this.LOGIN_SESSION_PREFIX}${dto.sessionId}`;
    const raw = await this.redisService.get(sessionKey);

    if (!raw) {
      throw new NotFoundException('Desktop session not found or expired');
    }

    const session = JSON.parse(raw);

    if (session.status !== 'pending') {
      throw new BadRequestException('Desktop session has already been used');
    }

    // Get user and generate tokens for desktop
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const tokens = this.generateTokenPair(user);

    await this.redisService.set(
      sessionKey,
      JSON.stringify({
        status: 'verified',
        ...tokens,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        },
      }),
      this.LOGIN_SESSION_RESULT_TTL,
    );

    return { success: true };
  }

  // Cleanup expired tokens (can be called by a cron job)
  async cleanupExpiredTokens(): Promise<void> {
    await this.db
      .delete(schema.emailVerificationTokens)
      .where(lt(schema.emailVerificationTokens.expiresAt, new Date()));
  }
}
