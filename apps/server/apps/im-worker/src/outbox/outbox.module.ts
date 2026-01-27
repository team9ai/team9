import { Module } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { RedisModule } from '@team9/redis';
import { RabbitmqModule } from '@team9/rabbitmq';
import { OutboxProcessorService } from './outbox-processor.service.js';

/**
 * Outbox Module - Audit & Manual Recovery
 *
 * Handles:
 * - Unread count updates
 * - Manual recovery for stale events
 *
 * Note: Offline message storage removed - using SeqId-based incremental sync.
 * Messages are synced when user opens a channel via GET /v1/im/sync/channel/:channelId
 */
@Module({
  imports: [DatabaseModule, RedisModule, RabbitmqModule],
  providers: [OutboxProcessorService],
  exports: [OutboxProcessorService],
})
export class OutboxModule {}
