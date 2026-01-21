import { Injectable, Logger, Inject } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE_CONNECTION, eq, and, isNull, sql } from '@team9/database';
import type { PostgresJsDatabase } from '@team9/database';
import * as schema from '@team9/database/schemas';
import { RedisService } from '@team9/redis';
import { RabbitMQEventService } from '@team9/rabbitmq';
import {
  parseMentions,
  type PostBroadcastTask,
  type IMMessageEnvelope,
  type DeviceSession,
  type MentionNotificationTask,
  type ReplyNotificationTask,
  type DMNotificationTask,
  type ParsedMention,
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

      // 6. Process notification tasks (mentions, replies, DMs)
      await this.processNotificationTasks(msgId, channelId, senderId);

      // 7. Mark Outbox as completed
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
   * Returns a JSON-serializable object (seqId as string, not bigint)
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

    // Convert bigint seqId to string for JSON serialization
    return {
      msgId: msg.id,
      seqId: msg.seqId?.toString() as unknown as bigint,
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
          id: uuidv7(),
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

  /**
   * Process notification tasks for a message
   * Publishes notification tasks to RabbitMQ for Gateway to process
   */
  async processNotificationTasks(
    msgId: string,
    channelId: string,
    senderId: string,
  ): Promise<void> {
    try {
      // Get message with related data
      const messageData = await this.getMessageWithContext(msgId);
      if (!messageData) {
        this.logger.warn(
          `Message ${msgId} not found for notification processing`,
        );
        return;
      }

      const { message, sender, channel, mentions, parentMessage } = messageData;

      // Skip if channel has no tenant (DM channels handled separately)
      const tenantId = channel.tenantId;

      // 1. Process mention notifications
      if (mentions.length > 0 && tenantId) {
        const mentionTask: MentionNotificationTask = {
          type: 'mention',
          timestamp: Date.now(),
          payload: {
            messageId: msgId,
            channelId,
            tenantId,
            senderId,
            senderUsername: sender.username,
            channelName: channel.name ?? 'channel',
            content: message.content ?? '',
            mentions: mentions.map((m) => ({
              userId: m.userId,
              type: m.type,
            })),
          },
        };
        await this.rabbitMQEventService.publishNotificationTask(mentionTask);
        this.logger.debug(
          `Published mention notification task for message ${msgId}`,
        );
      }

      // 2. Process reply notifications
      if (parentMessage && tenantId) {
        const replyTask: ReplyNotificationTask = {
          type: 'reply',
          timestamp: Date.now(),
          payload: {
            messageId: msgId,
            channelId,
            tenantId,
            senderId,
            senderUsername: sender.username,
            parentMessageId: parentMessage.id,
            parentSenderId: parentMessage.senderId!,
            content: message.content ?? '',
          },
        };
        await this.rabbitMQEventService.publishNotificationTask(replyTask);
        this.logger.debug(
          `Published reply notification task for message ${msgId}`,
        );
      }

      // 3. Process DM notifications (for direct message channels)
      if (channel.type === 'direct') {
        // Get the other participant in the DM
        const members = await this.getChannelMemberIds(channelId);
        const recipientId = members.find((id) => id !== senderId);

        if (recipientId) {
          const dmTask: DMNotificationTask = {
            type: 'dm',
            timestamp: Date.now(),
            payload: {
              messageId: msgId,
              channelId,
              senderId,
              senderUsername: sender.username,
              recipientId,
              content: message.content ?? '',
            },
          };
          await this.rabbitMQEventService.publishNotificationTask(dmTask);
          this.logger.debug(
            `Published DM notification task for message ${msgId}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to process notification tasks for message ${msgId}: ${error}`,
      );
      // Don't throw - notification failures shouldn't block message delivery
    }
  }

  /**
   * Get message with all context needed for notifications
   */
  private async getMessageWithContext(msgId: string): Promise<{
    message: schema.Message;
    sender: schema.User;
    channel: schema.Channel;
    mentions: ParsedMention[];
    parentMessage: schema.Message | null;
  } | null> {
    // Get message
    const [message] = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, msgId))
      .limit(1);

    if (!message || !message.senderId) {
      return null;
    }

    // Get sender
    const [sender] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, message.senderId))
      .limit(1);

    if (!sender) {
      return null;
    }

    // Get channel
    const [channel] = await this.db
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.id, message.channelId))
      .limit(1);

    if (!channel) {
      return null;
    }

    // Parse mentions directly from message content
    const mentions = message.content ? parseMentions(message.content) : [];

    // Get parent message if this is a reply
    let parentMessage: schema.Message | null = null;
    if (message.parentId) {
      const [parent] = await this.db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, message.parentId))
        .limit(1);
      parentMessage = parent ?? null;
    }

    return { message, sender, channel, mentions, parentMessage };
  }
}
