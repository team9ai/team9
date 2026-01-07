import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  sql,
  inArray,
  isNull,
} from '@team9/database';
import type { PostgresJsDatabase } from '@team9/database';
import * as schema from '@team9/database/schemas';
import { RedisService } from '@team9/redis';
import { RabbitMQEventService } from '@team9/rabbitmq';
import type { OutboxEventPayload, DeviceSession } from '@team9/shared';
// MessageRouterService no longer needed in hybrid mode
// Gateway handles real-time broadcast via Socket.io Redis Adapter

const REDIS_KEYS = {
  USER_MULTI_SESSION: (userId: string) => `im:session:user:${userId}`,
};

/**
 * Outbox Processor Service - FALLBACK ONLY
 *
 * This is a LOW-FREQUENCY fallback processor for guaranteed delivery.
 * Primary path is event-driven via PostBroadcastService (RabbitMQ).
 *
 * This processor only handles:
 * - Events that failed to be processed by PostBroadcastService
 * - Events where RabbitMQ message was lost
 * - Retry of failed operations
 *
 * HYBRID MODE Architecture:
 * 1. Gateway broadcasts to online users immediately (~10ms)
 * 2. Gateway sends post_broadcast event to RabbitMQ
 * 3. PostBroadcastService processes offline messages + unread counts (~50ms)
 * 4. OutboxProcessor polls every 30s as fallback for missed events
 */
@Injectable()
export class OutboxProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxProcessorService.name);
  private processingInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;

  // Processing configuration - LOW FREQUENCY fallback
  private readonly POLL_INTERVAL_MS = 30000; // 30 seconds (fallback only)
  private readonly BATCH_SIZE = 100;
  private readonly MAX_RETRY_COUNT = 3;

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly redisService: RedisService,
    private readonly rabbitMQEventService: RabbitMQEventService,
  ) {}

  onModuleInit(): void {
    this.startProcessing();
    this.logger.log(
      `Outbox fallback processor started (polling every ${this.POLL_INTERVAL_MS / 1000}s)`,
    );
  }

  onModuleDestroy(): void {
    this.stopProcessing();
    this.logger.log('Outbox processor stopped');
  }

  /**
   * Start the processing loop
   */
  private startProcessing(): void {
    this.processingInterval = setInterval(
      () => this.processOutbox(),
      this.POLL_INTERVAL_MS,
    );
  }

  /**
   * Stop the processing loop
   */
  private stopProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
  }

  /**
   * Main processing loop - scans and processes pending outbox events
   */
  async processOutbox(): Promise<void> {
    // Prevent concurrent processing
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      // Get pending events
      const pendingEvents = await this.db
        .select()
        .from(schema.messageOutbox)
        .where(
          and(
            inArray(schema.messageOutbox.status, ['pending', 'processing']),
            sql`${schema.messageOutbox.retryCount} < ${this.MAX_RETRY_COUNT}`,
          ),
        )
        .orderBy(schema.messageOutbox.createdAt)
        .limit(this.BATCH_SIZE);

      if (pendingEvents.length === 0) {
        return;
      }

      this.logger.debug(`Processing ${pendingEvents.length} outbox events`);

      for (const event of pendingEvents) {
        await this.processEvent(event);
      }
    } catch (error) {
      this.logger.error(`Outbox processing error: ${error}`);
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
