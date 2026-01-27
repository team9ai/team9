import { Injectable, Logger, Inject } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
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
import type { OutboxEventPayload } from '@team9/shared';

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
   * Note: Offline message storage removed - now using SeqId-based incremental sync.
   * Messages are synced when user opens a channel via GET /v1/im/sync/channel/:channelId
   *
   * This processor now only handles:
   * 1. Unread count updates
   * 2. Marking outbox as completed
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

      // Note: Offline message storage removed - now using SeqId-based incremental sync
      // Messages are synced when user opens a channel via GET /v1/im/sync/channel/:channelId

      // Update unread counts for ALL recipients
      await this.updateUnreadCounts(payload.channelId, recipientIds);

      // Mark as completed
      await this.markCompleted(event.id);

      this.logger.debug(
        `Processed outbox event ${event.id}: recipients=${recipientIds.length}`,
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
