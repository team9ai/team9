import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {
  DATABASE_CONNECTION,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { RedisService } from '@team9/redis';
import { env } from '@team9/shared';
import type { JwtPayload } from '@team9/auth';
import { RegisterDto, LoginDto } from './dto';

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
  private readonly REFRESH_TOKEN_PREFIX = 'im:refresh_token:';
  private readonly REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
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
        email: dto.email,
        username: dto.username,
        displayName: dto.displayName || dto.username,
        passwordHash,
      })
      .returning();

    // Generate tokens
    const tokens = await this.generateTokenPair(user);

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
    const tokens = await this.generateTokenPair(user);

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
        secret: env.JWT_REFRESH_SECRET,
      });

      // Verify refresh token is stored in Redis
      const storedToken = await this.redisService.get(
        `${this.REFRESH_TOKEN_PREFIX}${payload.sub}`,
      );

      if (storedToken !== refreshToken) {
        throw new UnauthorizedException('Invalid refresh token');
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

      // Delete old refresh token
      await this.redisService.del(`${this.REFRESH_TOKEN_PREFIX}${payload.sub}`);

      // Generate new tokens
      return this.generateTokenPair(user);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string): Promise<void> {
    await this.redisService.del(`${this.REFRESH_TOKEN_PREFIX}${userId}`);
  }

  private async generateTokenPair(user: {
    id: string;
    email: string;
    username: string;
  }): Promise<TokenPair> {
    const payload = {
      sub: user.id,
      email: user.email,
      username: user.username,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: env.JWT_SECRET,
      expiresIn: '7d',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: env.JWT_REFRESH_SECRET,
      expiresIn: '30d',
    });

    // Store refresh token in Redis
    await this.redisService.set(
      `${this.REFRESH_TOKEN_PREFIX}${user.id}`,
      refreshToken,
      this.REFRESH_TOKEN_TTL,
    );

    return { accessToken, refreshToken };
  }

  verifyToken(token: string): JwtPayload {
    return this.jwtService.verify<JwtPayload>(token, {
      secret: env.JWT_SECRET,
    });
  }
}
