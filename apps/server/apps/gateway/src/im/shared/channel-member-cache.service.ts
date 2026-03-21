import { Injectable, Inject } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '@team9/database';
import { RedisService } from '@team9/redis';
import * as schema from '@team9/database/schemas';

// Redis key pattern for channel member ID cache
const CHANNEL_MEMBERS_CACHE_KEY = (channelId: string) =>
  `im:cache:channel_members:${channelId}`;

// Cache TTL in seconds
const CACHE_TTL_SECONDS = 300;

@Injectable()
export class ChannelMemberCacheService {
  // Inflight map for stampede prevention: key -> Promise<string[]>
  private readonly inflight = new Map<string, Promise<string[]>>();

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Returns active member user IDs for the given channel.
   * Checks Redis cache first; falls back to DB on miss.
   * Concurrent calls for the same uncached channel coalesce into a single DB query.
   */
  async getMemberIds(channelId: string): Promise<string[]> {
    const cacheKey = CHANNEL_MEMBERS_CACHE_KEY(channelId);

    // Check Redis cache first
    const cached = await this.redisService.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached) as string[];
    }

    // Stampede prevention: coalesce concurrent requests for same channel
    const existing = this.inflight.get(channelId);
    if (existing) {
      return existing;
    }

    const promise = this.fetchAndCache(channelId, cacheKey);
    this.inflight.set(channelId, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(channelId);
    }
  }

  /**
   * Deletes the Redis cache entry for the given channel.
   * Should be called whenever channel membership changes.
   */
  async invalidate(channelId: string): Promise<void> {
    const cacheKey = CHANNEL_MEMBERS_CACHE_KEY(channelId);
    await this.redisService.del(cacheKey);
  }

  /**
   * Queries DB for active members and writes result to Redis.
   * Throws if DB query fails — does NOT write to Redis in that case.
   */
  private async fetchAndCache(
    channelId: string,
    cacheKey: string,
  ): Promise<string[]> {
    // Query active members (leftAt IS NULL)
    const rows = await this.db
      .select({ userId: schema.channelMembers.userId })
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          isNull(schema.channelMembers.leftAt),
        ),
      );

    const memberIds: string[] = rows.map(
      (row: { userId: string }) => row.userId,
    );

    // Write to Redis with TTL — only on success
    await this.redisService.set(
      cacheKey,
      JSON.stringify(memberIds),
      CACHE_TTL_SECONDS,
    );

    return memberIds;
  }
}
