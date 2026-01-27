import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { RedisService } from '@team9/redis';
import { env } from '@team9/shared';
import type { JwtPayload } from '@team9/auth';
import { RegisterDto, LoginDto } from './dto/index.js';
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

@Injectable()
export class AuthService {
  private readonly TOKEN_BLACKLIST_PREFIX = 'im:token_blacklist:';

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    // Check if email or username already exists
    const existingUser = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, dto.email))
      .limit(1);

    if (existingUser.length > 0) {
      throw new UnauthorizedException('Email already exists');
    }

    const existingUsername = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, dto.username))
      .limit(1);

    if (existingUsername.length > 0) {
      throw new UnauthorizedException('Username already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // Create user
    const [user] = await this.db
      .insert(schema.users)
      .values({
        id: uuidv7(),
        email: dto.email,
        username: dto.username,
        displayName: dto.displayName || dto.username,
        passwordHash,
      })
      .returning();

    // Emit event to create a personal workspace for the user
    this.eventEmitter.emit(USER_EVENTS.REGISTERED, {
      userId: user.id,
      displayName: dto.displayName || dto.username,
    } satisfies UserRegisteredEvent);

    // Emit event for search indexing
    this.eventEmitter.emit('user.created', { user });

    // Generate tokens
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

  async login(dto: LoginDto): Promise<AuthResponse> {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, dto.email))
      .limit(1);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }

    // Generate tokens
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
}
