import { Injectable, Logger, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION, eq, and } from '@team9/database';
import type { PostgresJsDatabase } from '@team9/database';
import * as schema from '@team9/database/schemas/im';
import { RedisService } from '@team9/redis';
import {
  UpstreamMessage,
  AckPayload,
  ReadPayload,
  MQ_CONFIG,
} from '@team9/shared';

const REDIS_KEYS = {
  MESSAGE_ACK: (msgId: string) => `im:ack:${msgId}`,
  PENDING_ACK: (userId: string) => `im:pending_ack:${userId}`,
};

/**
 * ACK Service - handles message acknowledgments
 *
 * Responsibilities:
 * - Track message delivery status
 * - Handle client ACKs
 * - Manage retry logic for unacknowledged messages
 */
@Injectable()
export class AckService {
  private readonly logger = new Logger(AckService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Handle client ACK (delivered/read)
   */
  async handleClientAck(upstream: UpstreamMessage): Promise<void> {
    const { userId } = upstream;
    const payload = upstream.message.payload as AckPayload;
    const { msgId, ackType } = payload;

    try {
      if (ackType === 'delivered') {
        await this.markAsDelivered(msgId, userId);
      } else if (ackType === 'read') {
        await this.markAsRead(msgId, userId);
      }

      // Remove from pending ACK
      await this.removeFromPending(userId, msgId);

      this.logger.debug(
        `Processed ${ackType} ACK for message ${msgId} from user ${userId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to process ACK: ${error}`);
    }
  }

  /**
   * Handle read status update
   */
  async handleReadStatus(upstream: UpstreamMessage): Promise<void> {
    const { userId } = upstream;
    const { targetId: channelId } = upstream.message;
    const payload = upstream.message.payload as ReadPayload;
    const { lastReadMsgId } = payload;

    try {
      // Update read status in database
      await this.db
        .insert(schema.userChannelReadStatus)
        .values({
          userId,
          channelId,
          lastReadMessageId: lastReadMsgId,
          lastReadAt: new Date(),
          unreadCount: 0,
        })
        .onConflictDoUpdate({
          target: [
            schema.userChannelReadStatus.userId,
            schema.userChannelReadStatus.channelId,
          ],
          set: {
            lastReadMessageId: lastReadMsgId,
            lastReadAt: new Date(),
            unreadCount: 0,
          },
        });

      this.logger.debug(
        `Updated read status for user ${userId} in channel ${channelId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to update read status: ${error}`);
    }
  }

  /**
   * Mark message as delivered
   */
  private async markAsDelivered(msgId: string, userId: string): Promise<void> {
    await this.db
      .insert(schema.messageAcks)
      .values({
        messageId: msgId,
        userId,
        status: 'delivered',
        deliveredAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.messageAcks.messageId, schema.messageAcks.userId],
        set: {
          status: 'delivered',
          deliveredAt: new Date(),
        },
      });
  }

  /**
   * Mark message as read
   */
  private async markAsRead(msgId: string, userId: string): Promise<void> {
    await this.db
      .insert(schema.messageAcks)
      .values({
        messageId: msgId,
        userId,
        status: 'read',
        readAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.messageAcks.messageId, schema.messageAcks.userId],
        set: {
          status: 'read',
          readAt: new Date(),
        },
      });
  }

  /**
   * Add message to pending ACK queue
   */
  async addToPending(
    userId: string,
    msgId: string,
    timestamp: number = Date.now(),
  ): Promise<void> {
    const key = REDIS_KEYS.PENDING_ACK(userId);
    await this.redisService.getClient().zadd(key, timestamp, msgId);
  }

  /**
   * Remove message from pending ACK queue
   */
  async removeFromPending(userId: string, msgId: string): Promise<void> {
    const key = REDIS_KEYS.PENDING_ACK(userId);
    await this.redisService.getClient().zrem(key, msgId);
  }

  /**
   * Get pending messages that need retry
   */
  async getPendingMessages(
    userId: string,
    timeoutMs: number = MQ_CONFIG.ACK_TIMEOUT,
  ): Promise<string[]> {
    const key = REDIS_KEYS.PENDING_ACK(userId);
    const cutoff = Date.now() - timeoutMs;

    const msgIds = await this.redisService
      .getClient()
      .zrangebyscore(key, 0, cutoff, 'LIMIT', 0, 10);

    return msgIds;
  }

  /**
   * Check if message is acknowledged by user
   */
  async isAcknowledged(msgId: string, userId: string): Promise<boolean> {
    const ack = await this.db
      .select()
      .from(schema.messageAcks)
      .where(
        and(
          eq(schema.messageAcks.messageId, msgId),
          eq(schema.messageAcks.userId, userId),
        ),
      )
      .limit(1);

    return (
      ack.length > 0 &&
      (ack[0].status === 'delivered' || ack[0].status === 'read')
    );
  }
}
