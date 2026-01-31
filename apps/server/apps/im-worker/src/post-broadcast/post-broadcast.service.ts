import { Injectable, Logger, Inject } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  isNull,
  inArray,
  sql,
} from '@team9/database';
import type { PostgresJsDatabase } from '@team9/database';
import * as schema from '@team9/database/schemas';
import { RabbitMQEventService } from '@team9/rabbitmq';
import {
  parseMentions,
  type PostBroadcastTask,
  type MentionNotificationTask,
  type ReplyNotificationTask,
  type DMNotificationTask,
  type ParsedMention,
} from '@team9/shared';

/**
 * Post-Broadcast Service
 *
 * Handles tasks after Gateway broadcasts to online users:
 * - Unread count updates
 * - Notification task processing (mentions, replies, DMs)
 * - Mark Outbox event as completed
 *
 * Note: Offline message storage removed - now using SeqId-based incremental sync.
 * Messages are synced when user opens a channel via GET /v1/im/sync/channel/:channelId
 */
@Injectable()
export class PostBroadcastService {
  private readonly logger = new Logger(PostBroadcastService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
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

      // Note: Offline message storage removed - now using SeqId-based incremental sync
      // Messages are synced when user opens a channel via GET /v1/im/sync/channel/:channelId

      // 2. Update unread counts for ALL recipients
      await this.updateUnreadCounts(channelId, recipientIds);

      // 3. Process notification tasks (mentions, replies, DMs)
      await this.processNotificationTasks(msgId, channelId, senderId);

      // 4. Push to bot webhooks (fire-and-forget, errors logged but not thrown)
      await this.pushToBotWebhooks(msgId, senderId, memberIds);

      // 5. Mark Outbox as completed
      await this.markOutboxCompleted(msgId);

      this.logger.debug(
        `Post-broadcast completed for ${msgId}: recipients=${recipientIds.length}, latency=${Date.now() - broadcastAt}ms`,
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

      // 2. Process reply notifications (with thread context)
      if (parentMessage && tenantId) {
        // Get root message if this is a thread reply (message has rootId)
        let rootMessage: schema.Message | null = null;
        const isThreadReply =
          message.rootId && message.rootId !== message.parentId;

        if (isThreadReply && message.rootId) {
          const [root] = await this.db
            .select()
            .from(schema.messages)
            .where(eq(schema.messages.id, message.rootId))
            .limit(1);
          rootMessage = root ?? null;
        }

        const replyTask: ReplyNotificationTask = {
          type: 'reply',
          timestamp: Date.now(),
          payload: {
            messageId: msgId,
            channelId,
            tenantId,
            senderId,
            senderUsername: sender.username,
            channelName: channel.name ?? 'channel',
            parentMessageId: parentMessage.id,
            parentSenderId: parentMessage.senderId!,
            content: message.content ?? '',
            // Thread context
            rootMessageId: message.rootId ?? parentMessage.id,
            rootSenderId: rootMessage?.senderId ?? parentMessage.senderId!,
            isThreadReply: !!isThreadReply,
          },
        };
        await this.rabbitMQEventService.publishNotificationTask(replyTask);
        this.logger.debug(
          `Published ${isThreadReply ? 'thread_reply' : 'reply'} notification task for message ${msgId}`,
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

  // ── Bot Webhook Push ─────────────────────────────────────────────

  /**
   * Push message to bot webhooks for bots in the channel.
   * Fire-and-forget: failures are logged but do not block message delivery.
   */
  private async pushToBotWebhooks(
    msgId: string,
    senderId: string,
    memberIds: string[],
  ): Promise<void> {
    try {
      if (memberIds.length === 0) return;

      // Find bot members in this channel that have webhookUrls configured
      const botMembers = await this.db
        .select({
          userId: schema.bots.userId,
          webhookUrl: schema.bots.webhookUrl,
          webhookHeaders: schema.bots.webhookHeaders,
          botId: schema.bots.id,
        })
        .from(schema.bots)
        .innerJoin(schema.users, eq(schema.bots.userId, schema.users.id))
        .where(
          and(
            inArray(schema.bots.userId, memberIds),
            eq(schema.bots.isActive, true),
            eq(schema.users.userType, 'bot'),
            sql`${schema.bots.webhookUrl} IS NOT NULL`,
          ),
        );

      if (botMembers.length === 0) return;

      // Skip bots that are the sender (bot shouldn't webhook itself)
      const targetBots = botMembers.filter((b) => b.userId !== senderId);
      if (targetBots.length === 0) return;

      // Get message details for webhook payload
      const messageData = await this.getMessageWithContext(msgId);
      if (!messageData) return;

      const { message, sender, channel } = messageData;

      const webhookPayload = {
        event: 'message.created',
        timestamp: new Date().toISOString(),
        data: {
          messageId: message.id,
          channelId: message.channelId,
          senderId: message.senderId,
          content: message.content,
          type: message.type,
          parentId: message.parentId,
          createdAt: message.createdAt,
          sender: {
            id: sender.id,
            username: sender.username,
            displayName: sender.displayName,
          },
          channel: {
            id: channel.id,
            name: channel.name,
            type: channel.type,
          },
        },
      };

      // Fire-and-forget HTTP calls to each bot's webhook
      for (const bot of targetBots) {
        const customHeaders =
          bot.webhookHeaders && typeof bot.webhookHeaders === 'object'
            ? (bot.webhookHeaders as Record<string, string>)
            : {};
        this.deliverWebhook(
          bot.webhookUrl!,
          bot.botId,
          webhookPayload,
          customHeaders,
        ).catch((err) => {
          this.logger.warn(
            `Webhook delivery failed for bot ${bot.botId}: ${err.message}`,
          );
        });
      }
    } catch (error) {
      this.logger.warn(`Bot webhook push failed: ${error}`);
      // Don't throw - webhook failures should never block message delivery
    }
  }

  /**
   * Deliver a webhook payload to a bot's URL with a timeout.
   */
  private async deliverWebhook(
    url: string,
    botId: string,
    payload: unknown,
    customHeaders: Record<string, string> = {},
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Team9-Event': 'message.created',
          'X-Team9-Bot-Id': botId,
          ...customHeaders,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(
          `Webhook returned ${response.status} for bot ${botId}`,
        );
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
