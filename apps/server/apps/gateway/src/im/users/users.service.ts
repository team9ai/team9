import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  or,
  like,
  sql,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { RedisService } from '@team9/redis';
import { UpdateUserDto } from './dto/index.js';

export interface UserResponse {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: 'online' | 'offline' | 'away' | 'busy';
  lastSeenAt: Date | null;
}

@Injectable()
export class UsersService {
  private readonly ONLINE_USERS_KEY = 'im:online_users';
  private readonly USER_CACHE_PREFIX = 'im:user:';
  private readonly USER_CACHE_TTL = 3600; // 1 hour

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly redisService: RedisService,
  ) {}

  async findById(id: string): Promise<UserResponse | null> {
    // Try cache first
    const cached = await this.redisService.get(
      `${this.USER_CACHE_PREFIX}${id}`,
    );
    if (cached) {
      return JSON.parse(cached) as UserResponse;
    }

    const [user] = await this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
        status: schema.users.status,
        lastSeenAt: schema.users.lastSeenAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);

    if (user) {
      await this.redisService.set(
        `${this.USER_CACHE_PREFIX}${id}`,
        JSON.stringify(user),
        this.USER_CACHE_TTL,
      );
    }

    return user || null;
  }

  async findByIdOrThrow(id: string): Promise<UserResponse> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserResponse> {
    const [user] = await this.db
      .update(schema.users)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, id))
      .returning({
        id: schema.users.id,
        email: schema.users.email,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
        status: schema.users.status,
        lastSeenAt: schema.users.lastSeenAt,
      });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Clear cache
    await this.redisService.del(`${this.USER_CACHE_PREFIX}${id}`);

    return user;
  }

  async updateStatus(
    userId: string,
    status: 'online' | 'offline' | 'away' | 'busy',
  ): Promise<void> {
    await this.db
      .update(schema.users)
      .set({
        status,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId));

    // Update Redis cache
    if (status === 'online') {
      await this.redisService.hset(this.ONLINE_USERS_KEY, userId, status);
    } else if (status === 'offline') {
      await this.redisService.hdel(this.ONLINE_USERS_KEY, userId);
    } else {
      await this.redisService.hset(this.ONLINE_USERS_KEY, userId, status);
    }

    // Clear user cache
    await this.redisService.del(`${this.USER_CACHE_PREFIX}${userId}`);
  }

  async setOnline(userId: string): Promise<void> {
    await this.updateStatus(userId, 'online');
  }

  async setOffline(userId: string): Promise<void> {
    await this.updateStatus(userId, 'offline');
  }

  async getOnlineUsers(): Promise<Record<string, string>> {
    return this.redisService.hgetall(this.ONLINE_USERS_KEY);
  }

  async isOnline(userId: string): Promise<boolean> {
    const status = await this.redisService.hget(this.ONLINE_USERS_KEY, userId);
    return status === 'online';
  }

  async search(query: string, limit = 20): Promise<UserResponse[]> {
    const users = await this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
        status: schema.users.status,
        lastSeenAt: schema.users.lastSeenAt,
      })
      .from(schema.users)
      .where(
        or(
          like(schema.users.username, `%${query}%`),
          like(schema.users.displayName, `%${query}%`),
        ),
      )
      .limit(limit);

    return users;
  }

  async getMultipleByIds(ids: string[]): Promise<UserResponse[]> {
    if (ids.length === 0) return [];

    const users = await this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
        status: schema.users.status,
        lastSeenAt: schema.users.lastSeenAt,
      })
      .from(schema.users)
      .where(sql`${schema.users.id} = ANY(${ids})`);

    return users;
  }
}
