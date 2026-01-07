import { Injectable, Logger, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION, eq, and, isNull, sql } from '@team9/database';
import type { PostgresJsDatabase } from '@team9/database';
import * as schema from '@team9/database/schemas';
import { RedisService } from '@team9/redis';
import { RabbitMQEventService } from '@team9/rabbitmq';
import type {
  PostBroadcastTask,
  IMMessageEnvelope,
  DeviceSession,
} from '@team9/shared';

const REDIS_KEYS = {
  USER_MULTI_SESSION: (userId: string) => `im:session:user:${userId}`,
};

/**
 * Post-Broadcast Service
 *
 * Handles tasks after Gateway broadcasts to online users:
 * - Offline message storage
 * - Unread count updates
 * - Mark Outbox event as completed
 *
 * This service is event-driven (via RabbitMQ), replacing the polling-based Outbox processor.
 */
@Injectable()
export class PostBroadcastService {
  private readonly logger = new Logger(PostBroadcastService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly redisService: RedisService,
    private readonly rabbitMQEventService: RabbitMQEventService,
  ) {}

  /**
   * Process a post-broadcast task
   * Called immediately after Gateway broadcasts to online users
   */
  async processTask(task: PostBroadcastTask): Promise<void> {
    const { msgId, channelId, senderId, workspaceId, broadcastAt } = task;

    try {
      // 1. Get channel members (excluding sender)
      const memberIds = await this.getChannelMemberIds(channelId);
      const recipientIds = memberIds.filter((id) => id !== senderId);

      if (recipientIds.length === 0) {
        await this.markOutboxCompleted(msgId);
        return;
      }

      // 2. Get device sessions to identify offline users
      const userSessions = await this.getAllDeviceSessionsBatch(recipientIds);

      // 3. Identify offline users
      const offlineUsers: string[] = [];
      for (const userId of recipientIds) {
        const sessions = userSessions.get(userId);
        if (!sessions || sessions.length === 0) {
          offlineUsers.push(userId);
        }
      }

      // 4. Store offline messages
      if (offlineUsers.length > 0 && workspaceId) {
        const message = await this.getMessageEnvelope(msgId);
        if (message) {
          await this.rabbitMQEventService.sendToOfflineUsers(
            workspaceId,
            offlineUsers,
            'new_message',
            message,
          );
        }
      }

      // 5. Update unread counts for ALL recipients
      await this.updateUnreadCounts(channelId, recipientIds);

      // 6. Mark Outbox as completed
      await this.markOutboxCompleted(msgId);

      this.logger.debug(
        `Post-broadcast completed for ${msgId}: offline=${offlineUsers.length}, total=${recipientIds.length}, latency=${Date.now() - broadcastAt}ms`,
      );
    } catch (error) {
      this.logger.error(`Failed to process post-broadcast task: ${error}`);
      throw error; // Let the consumer handle retry
    }
  }

  /**
   * Get channel member IDs
   */
  private async getChannelMemberIds(channelId: string): Promise<string[]> {
    const members = await this.db
      .select({ userId: schema.channelMembers.userId })
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          isNull(schema.channelMembers.leftAt),
        ),
      );

    return members.map((m) => m.userId);
  }

  /**
   * Get device sessions for multiple users
   */
  private async getAllDeviceSessionsBatch(
    userIds: string[],
  ): Promise<Map<string, DeviceSession[]>> {
    const client = this.redisService.getClient();
    const pipeline = client.pipeline();

    for (const userId of userIds) {
      pipeline.hgetall(REDIS_KEYS.USER_MULTI_SESSION(userId));
    }

    const results = await pipeline.exec();
    const sessionMap = new Map<string, DeviceSession[]>();

    results?.forEach((result, index) => {
      const [err, data] = result;
      if (!err && data && Object.keys(data as object).length > 0) {
        const sessions = Object.values(data as Record<string, string>).map(
          (v) => JSON.parse(v) as DeviceSession,
        );
        sessionMap.set(userIds[index], sessions);
      }
    });

    return sessionMap;
  }

  /**
   * Get message envelope from database
   */
  private async getMessageEnvelope(
    msgId: string,
  ): Promise<IMMessageEnvelope | null> {
    const [msg] = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, msgId))
      .limit(1);

    if (!msg) {
      return null;
    }

    return {
      msgId: msg.id,
      seqId: msg.seqId ?? undefined,
      clientMsgId: msg.clientMsgId ?? undefined,
      type: msg.type as 'text' | 'file' | 'image' | 'system',
      senderId: msg.senderId!,
      targetType: 'channel',
      targetId: msg.channelId,
      payload: {
        content: msg.content ?? '',
        parentId: msg.parentId ?? undefined,
      },
      timestamp: msg.createdAt.getTime(),
    };
  }

  /**
   * Update unread counts for recipients
   */
  private async updateUnreadCounts(
    channelId: string,
    recipientIds: string[],
  ): Promise<void> {
    for (const userId of recipientIds) {
      await this.db
        .insert(schema.userChannelReadStatus)
        .values({
          userId,
          channelId,
          unreadCount: 1,
        })
        .onConflictDoUpdate({
          target: [
            schema.userChannelReadStatus.userId,
            schema.userChannelReadStatus.channelId,
          ],
          set: {
            unreadCount: sql`${schema.userChannelReadStatus.unreadCount} + 1`,
          },
        });
    }
  }

  /**
   * Mark Outbox event as completed
   */
  private async markOutboxCompleted(msgId: string): Promise<void> {
    await this.db
      .update(schema.messageOutbox)
      .set({
        status: 'completed',
        processedAt: new Date(),
      })
      .where(eq(schema.messageOutbox.messageId, msgId));
  }
}
