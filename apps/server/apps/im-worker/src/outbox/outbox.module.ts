import { Module } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { RedisModule } from '@team9/redis';
import { RabbitmqModule } from '@team9/rabbitmq';
import { OutboxProcessorService } from './outbox-processor.service.js';

/**
 * Outbox Module - Hybrid Mode
 *
 * Handles post-broadcast tasks:
 * - Offline message storage
 * - Unread count updates
 *
 * Note: Real-time broadcast is handled by Gateway via Socket.io Redis Adapter
 */
@Module({
  imports: [DatabaseModule, RedisModule, RabbitmqModule],
  providers: [OutboxProcessorService],
  exports: [OutboxProcessorService],
})
export class OutboxModule {}
