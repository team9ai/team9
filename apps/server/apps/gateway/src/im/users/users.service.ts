import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  or,
  like,
  sql,
  inArray,
  isNull,
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
  userType: 'human' | 'bot' | 'system';
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
    private readonly eventEmitter: EventEmitter2,
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
        userType: schema.users.userType,
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
    const [updatedUser] = await this.db
      .update(schema.users)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, id))
      .returning();

    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }

    // Clear cache
    await this.redisService.del(`${this.USER_CACHE_PREFIX}${id}`);

    // Emit event for search indexing
    this.eventEmitter.emit('user.updated', { user: updatedUser });

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      username: updatedUser.username,
      displayName: updatedUser.displayName,
      avatarUrl: updatedUser.avatarUrl,
      status: updatedUser.status,
      lastSeenAt: updatedUser.lastSeenAt,
      userType: updatedUser.userType,
    };
  }

  async updateStatus(
    userId: string,
    status: 'online' | 'offline' | 'away' | 'busy',
  ): Promise<void> {
    console.log(
      `[UsersService] Updating status for user ${userId} to ${status}`,
    );

    // Only update Redis for online status management
    // Database status field is deprecated - only Redis is the source of truth
    if (status === 'online') {
      console.log(
        `[UsersService] Adding user ${userId} to Redis key: ${this.ONLINE_USERS_KEY}`,
      );
      await this.redisService.hset(this.ONLINE_USERS_KEY, userId, status);
      console.log(
        `[UsersService] User ${userId} added to online users in Redis`,
      );

      // Verify it was written
      const verify = await this.redisService.hget(
        this.ONLINE_USERS_KEY,
        userId,
      );
      console.log(
        `[UsersService] Verification: Redis value for ${userId} = ${verify}`,
      );
    } else if (status === 'offline') {
      console.log(`[UsersService] Removing user ${userId} from Redis`);
      await this.redisService.hdel(this.ONLINE_USERS_KEY, userId);

      // Update lastSeenAt when going offline
      await this.db
        .update(schema.users)
        .set({
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, userId));
      console.log(`[UsersService] Updated lastSeenAt for user ${userId}`);
    } else {
      // away or busy
      console.log(
        `[UsersService] Setting user ${userId} status to ${status} in Redis`,
      );
      await this.redisService.hset(this.ONLINE_USERS_KEY, userId, status);
    }

    // Clear user cache
    await this.redisService.del(`${this.USER_CACHE_PREFIX}${userId}`);
  }

  async setOnline(userId: string): Promise<void> {
    console.log(`[UsersService] setOnline called for user: ${userId}`);
    await this.updateStatus(userId, 'online');
    console.log(`[UsersService] setOnline completed for user: ${userId}`);
  }

  async setOffline(userId: string): Promise<void> {
    await this.updateStatus(userId, 'offline');
  }

  /**
   * Get user status from Redis (real-time source of truth)
   * Returns 'offline' if not found in Redis
   */
  async getUserStatus(
    userId: string,
  ): Promise<'online' | 'offline' | 'away' | 'busy'> {
    const status = await this.redisService.hget(this.ONLINE_USERS_KEY, userId);
    return (status as 'online' | 'away' | 'busy') || 'offline';
  }

  async getOnlineUsers(): Promise<Record<string, string>> {
    return this.redisService.hgetall(this.ONLINE_USERS_KEY);
  }

  async isOnline(userId: string): Promise<boolean> {
    const status = await this.redisService.hget(this.ONLINE_USERS_KEY, userId);
    return status === 'online';
  }

  async search(
    query: string,
    limit = 20,
    tenantId?: string,
  ): Promise<UserResponse[]> {
    const searchCondition = or(
      like(schema.users.username, `%${query}%`),
      like(schema.users.displayName, `%${query}%`),
    );

    const conditions = tenantId
      ? and(
          searchCondition,
          inArray(
            schema.users.id,
            this.db
              .select({ userId: schema.tenantMembers.userId })
              .from(schema.tenantMembers)
              .where(
                and(
                  eq(schema.tenantMembers.tenantId, tenantId),
                  isNull(schema.tenantMembers.leftAt),
                ),
              ),
          ),
        )
      : searchCondition;

    const users = await this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
        status: schema.users.status,
        lastSeenAt: schema.users.lastSeenAt,
        userType: schema.users.userType,
      })
      .from(schema.users)
      .where(conditions)
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
        userType: schema.users.userType,
      })
      .from(schema.users)
      .where(sql`${schema.users.id} = ANY(${ids})`);

    return users;
  }
}
