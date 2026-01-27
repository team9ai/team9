import { Injectable, Inject, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  gt,
  inArray,
  sql,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { RedisService } from '@team9/redis';
import type { SyncMessagesResponse, SyncMessageItem } from '@team9/shared';
import { REDIS_KEYS } from '../shared/constants/redis-keys.js';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Sync messages for a single channel (lazy loading)
   * Called when user opens a channel
   */
  async syncChannel(
    userId: string,
    channelId: string,
    limit = 50,
  ): Promise<SyncMessagesResponse> {
    // 1. Get user's lastSyncSeqId from Redis cache (fast path)
    let lastSyncSeqId = await this.getLastSyncSeqIdFromCache(userId, channelId);

    // 2. If cache miss, fallback to database
    if (lastSyncSeqId === null) {
      lastSyncSeqId = await this.getLastSyncSeqIdFromDb(userId, channelId);
      // Cache it for next time
      if (lastSyncSeqId !== null) {
        await this.cacheLastSyncSeqId(userId, channelId, lastSyncSeqId);
      }
    }

    // Default to 0 if no sync position exists
    const afterSeqId = lastSyncSeqId ?? BigInt(0);

    // 3. Get channel's current maxSeqId from Redis (already cached)
    const maxSeqId = await this.getChannelMaxSeqId(channelId);

    // 4. If no new messages, return empty
    if (maxSeqId <= afterSeqId) {
      return {
        channelId,
        messages: [],
        fromSeqId: afterSeqId.toString(),
        toSeqId: afterSeqId.toString(),
        hasMore: false,
      };
    }

    // 5. Query incremental messages from database
    const messages = await this.db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.channelId, channelId),
          gt(schema.messages.seqId, afterSeqId),
          eq(schema.messages.isDeleted, false),
        ),
      )
      .orderBy(schema.messages.seqId)
      .limit(limit + 1);

    const hasMore = messages.length > limit;
    const actualMessages = messages.slice(0, limit);

    // 6. Batch fetch sender info
    const syncMessages = await this.enrichMessagesWithSenders(actualMessages);

    // 7. Calculate new sync position
    const toSeqId =
      actualMessages.length > 0
        ? (actualMessages[actualMessages.length - 1].seqId ?? afterSeqId)
        : afterSeqId;

    // 8. Update sync position (both Redis and DB)
    if (actualMessages.length > 0) {
      await this.updateSyncPosition(userId, channelId, toSeqId);
    }

    return {
      channelId,
      messages: syncMessages,
      fromSeqId: afterSeqId.toString(),
      toSeqId: toSeqId.toString(),
      hasMore,
    };
  }

  /**
   * Update sync position for a user in a channel
   * Updates both Redis cache and database
   */
  async updateSyncPosition(
    userId: string,
    channelId: string,
    seqId: bigint,
  ): Promise<void> {
    // Update Redis cache first (fast)
    await this.cacheLastSyncSeqId(userId, channelId, seqId);

    // Update database (async, for persistence)
    await this.db
      .insert(schema.userChannelReadStatus)
      .values({
        id: uuidv7(),
        userId,
        channelId,
        lastSyncSeqId: seqId,
        lastReadAt: new Date(),
        unreadCount: 0,
      })
      .onConflictDoUpdate({
        target: [
          schema.userChannelReadStatus.userId,
          schema.userChannelReadStatus.channelId,
        ],
        set: {
          // Only update if new seqId is greater (position only moves forward)
          lastSyncSeqId: sql`GREATEST(COALESCE(${schema.userChannelReadStatus.lastSyncSeqId}, 0), ${seqId})`,
        },
      });

    this.logger.debug(
      `Updated sync position: user=${userId}, channel=${channelId}, seqId=${seqId}`,
    );
  }

  /**
   * Get lastSyncSeqId from Redis cache
   */
  private async getLastSyncSeqIdFromCache(
    userId: string,
    channelId: string,
  ): Promise<bigint | null> {
    const client = this.redisService.getClient();
    const value = await client.hget(
      REDIS_KEYS.USER_SYNC_POSITIONS(userId),
      channelId,
    );
    return value ? BigInt(value) : null;
  }

  /**
   * Get lastSyncSeqId from database
   */
  private async getLastSyncSeqIdFromDb(
    userId: string,
    channelId: string,
  ): Promise<bigint | null> {
    const result = await this.db
      .select({ lastSyncSeqId: schema.userChannelReadStatus.lastSyncSeqId })
      .from(schema.userChannelReadStatus)
      .where(
        and(
          eq(schema.userChannelReadStatus.userId, userId),
          eq(schema.userChannelReadStatus.channelId, channelId),
        ),
      )
      .limit(1);

    return result[0]?.lastSyncSeqId ?? null;
  }

  /**
   * Cache lastSyncSeqId to Redis
   */
  private async cacheLastSyncSeqId(
    userId: string,
    channelId: string,
    seqId: bigint,
  ): Promise<void> {
    const client = this.redisService.getClient();
    await client.hset(
      REDIS_KEYS.USER_SYNC_POSITIONS(userId),
      channelId,
      seqId.toString(),
    );
  }

  /**
   * Get channel's current max seqId from Redis
   */
  private async getChannelMaxSeqId(channelId: string): Promise<bigint> {
    const value = await this.redisService.get(
      REDIS_KEYS.CHANNEL_SEQ(channelId),
    );
    return value ? BigInt(value) : BigInt(0);
  }

  /**
   * Enrich messages with sender information
   */
  private async enrichMessagesWithSenders(
    messages: schema.Message[],
  ): Promise<SyncMessageItem[]> {
    if (messages.length === 0) {
      return [];
    }

    // Get unique sender IDs
    const senderIds = [
      ...new Set(messages.map((m) => m.senderId).filter(Boolean)),
    ] as string[];

    // Batch fetch senders
    const sendersMap = new Map<
      string,
      {
        id: string;
        username: string;
        displayName: string | null;
        avatarUrl: string | null;
      }
    >();

    if (senderIds.length > 0) {
      const senders = await this.db
        .select({
          id: schema.users.id,
          username: schema.users.username,
          displayName: schema.users.displayName,
          avatarUrl: schema.users.avatarUrl,
        })
        .from(schema.users)
        .where(inArray(schema.users.id, senderIds));

      senders.forEach((s) => sendersMap.set(s.id, s));
    }

    // Build response
    return messages.map((msg) => ({
      id: msg.id,
      channelId: msg.channelId,
      senderId: msg.senderId,
      parentId: msg.parentId,
      rootId: msg.rootId,
      content: msg.content,
      type: msg.type,
      seqId: msg.seqId?.toString() ?? '0',
      isPinned: msg.isPinned,
      isEdited: msg.isEdited,
      createdAt: msg.createdAt.toISOString(),
      updatedAt: msg.updatedAt.toISOString(),
      sender: msg.senderId ? sendersMap.get(msg.senderId) : undefined,
    }));
  }

  /**
   * Clear sync position cache for a user (e.g., on logout)
   */
  async clearSyncCache(userId: string): Promise<void> {
    const client = this.redisService.getClient();
    await client.del(REDIS_KEYS.USER_SYNC_POSITIONS(userId));
  }
}
