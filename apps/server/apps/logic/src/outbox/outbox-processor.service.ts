import { Injectable, Logger, Inject } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  sql,
  inArray,
  isNull,
  lt,
} from '@team9/database';
import type { PostgresJsDatabase } from '@team9/database';
import * as schema from '@team9/database/schemas';
import { RedisService } from '@team9/redis';
import { RabbitMQEventService } from '@team9/rabbitmq';
import type { OutboxEventPayload, DeviceSession } from '@team9/shared';

const REDIS_KEYS = {
  USER_MULTI_SESSION: (userId: string) => `im:session:user:${userId}`,
};

/**
 * Outbox Processor Service - AUDIT & MANUAL RECOVERY ONLY
 *
 * NO POLLING - Fully event-driven architecture via RabbitMQ.
 *
 * The Outbox table now serves as:
 * 1. Audit log for all message sends
 * 2. Manual recovery tool for debugging/operations
 * 3. Historical record for troubleshooting
 *
 * EVENT-DRIVEN Architecture:
 * 1. Gateway broadcasts to online users immediately via Socket.io Redis Adapter (~10ms)
 * 2. Gateway sends post_broadcast event to RabbitMQ
 * 3. PostBroadcastService processes offline messages + unread counts (~50ms)
 * 4. PostBroadcastService marks Outbox as completed
 *
 * If RabbitMQ message is lost (rare), use manual recovery methods:
 * - processStaleEvents() - manually trigger processing of stuck events
 * - getStaleEvents() - query events that haven't been processed
 */
@Injectable()
export class OutboxProcessorService {
  private readonly logger = new Logger(OutboxProcessorService.name);
  private isProcessing = false;

  // Configuration for manual recovery
  private readonly BATCH_SIZE = 100;
  private readonly MAX_RETRY_COUNT = 3;
  private readonly STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly redisService: RedisService,
    private readonly rabbitMQEventService: RabbitMQEventService,
  ) {
    this.logger.log(
      'OutboxProcessorService initialized (event-driven mode, no polling)',
    );
  }

  /**
   * Get stale events for monitoring/debugging
   * Events older than STALE_THRESHOLD_MS that are still pending
   */
  async getStaleEvents(): Promise<schema.MessageOutbox[]> {
    const staleThreshold = new Date(Date.now() - this.STALE_THRESHOLD_MS);

    return this.db
      .select()
      .from(schema.messageOutbox)
      .where(
        and(
          inArray(schema.messageOutbox.status, ['pending', 'processing']),
          lt(schema.messageOutbox.createdAt, staleThreshold),
        ),
      )
      .orderBy(schema.messageOutbox.createdAt)
      .limit(this.BATCH_SIZE);
  }

  /**
   * Manual recovery: Process stale events
   * Call this from admin API or CLI when investigating issues
   */
  async processStaleEvents(): Promise<{ processed: number; failed: number }> {
    if (this.isProcessing) {
      this.logger.warn('Manual processing already in progress');
      return { processed: 0, failed: 0 };
    }

    this.isProcessing = true;
    let processed = 0;
    let failed = 0;

    try {
      const staleEvents = await this.getStaleEvents();

      if (staleEvents.length === 0) {
        this.logger.log('No stale events to process');
        return { processed: 0, failed: 0 };
      }

      this.logger.log(`Processing ${staleEvents.length} stale outbox events`);

      for (const event of staleEvents) {
        try {
          await this.processEvent(event);
          processed++;
        } catch {
          failed++;
        }
      }

      this.logger.log(
        `Manual recovery completed: ${processed} processed, ${failed} failed`,
      );
      return { processed, failed };
    } catch (error) {
      this.logger.error(`Manual recovery error: ${error}`);
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single outbox event
   *
   * HYBRID MODE: Gateway already broadcast to online users via Socket.io Redis Adapter.
   * This processor only handles:
   * 1. Offline message storage
   * 2. Unread count updates
   */
  private async processEvent(event: schema.MessageOutbox): Promise<void> {
    try {
      // Mark as processing
      await this.db
        .update(schema.messageOutbox)
        .set({ status: 'processing' })
        .where(eq(schema.messageOutbox.id, event.id));

      // Parse payload
      const payload = event.payload as OutboxEventPayload;

      // Get channel members (excluding sender)
      const memberIds = await this.getChannelMemberIds(payload.channelId);
      const recipientIds = memberIds.filter((id) => id !== payload.senderId);

      if (recipientIds.length === 0) {
        // No recipients, mark as completed
        await this.markCompleted(event.id);
        return;
      }

      // Get all device sessions for recipients to identify offline users
      const userSessions = await this.getAllDeviceSessionsBatch(recipientIds);

      // Identify offline users (no active sessions)
      const offlineUsers: string[] = [];
      for (const userId of recipientIds) {
        const sessions = userSessions.get(userId);
        if (!sessions || sessions.length === 0) {
          offlineUsers.push(userId);
        }
      }

      // Store offline messages for users who weren't online during broadcast
      if (offlineUsers.length > 0 && payload.workspaceId) {
        // Use string for seqId to ensure JSON serialization works
        const message = {
          msgId: payload.msgId,
          seqId: payload.seqId, // Already a string from OutboxEventPayload
          type: payload.type,
          senderId: payload.senderId,
          targetType: 'channel' as const,
          targetId: payload.channelId,
          payload: {
            content: payload.content,
            parentId: payload.parentId,
          },
          timestamp: payload.timestamp,
        };

        await this.rabbitMQEventService.sendToOfflineUsers(
          payload.workspaceId,
          offlineUsers,
          'new_message',
          message,
        );
      }

      // Update unread counts for ALL recipients (online users also get unread count)
      await this.updateUnreadCounts(payload.channelId, recipientIds);

      // Mark as completed
      await this.markCompleted(event.id);

      this.logger.debug(
        `Processed outbox event ${event.id}: offline=${offlineUsers.length}, total_recipients=${recipientIds.length}`,
      );
    } catch (error) {
      await this.handleRetry(event, error as Error);
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
   * Get all device sessions for multiple users (multi-device support)
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
   * Mark event as completed
   */
  private async markCompleted(eventId: string): Promise<void> {
    await this.db
      .update(schema.messageOutbox)
      .set({
        status: 'completed',
        processedAt: new Date(),
      })
      .where(eq(schema.messageOutbox.id, eventId));
  }

  /**
   * Handle retry for failed event
   */
  private async handleRetry(
    event: schema.MessageOutbox,
    error: Error,
  ): Promise<void> {
    const newRetryCount = event.retryCount + 1;

    if (newRetryCount >= this.MAX_RETRY_COUNT) {
      // Max retries exceeded, mark as failed
      await this.db
        .update(schema.messageOutbox)
        .set({
          status: 'failed',
          retryCount: newRetryCount,
          errorMessage: error.message.slice(0, 500),
        })
        .where(eq(schema.messageOutbox.id, event.id));

      this.logger.error(
        `Outbox event ${event.id} failed after ${this.MAX_RETRY_COUNT} retries: ${error.message}`,
      );
    } else {
      // Retry later
      await this.db
        .update(schema.messageOutbox)
        .set({
          status: 'pending',
          retryCount: newRetryCount,
          errorMessage: error.message.slice(0, 500),
        })
        .where(eq(schema.messageOutbox.id, event.id));

      this.logger.warn(
        `Outbox event ${event.id} will retry (attempt ${newRetryCount}): ${error.message}`,
      );
    }
  }
}
