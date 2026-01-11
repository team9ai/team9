import { Module } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { RedisModule } from '@team9/redis';
import { RabbitmqModule } from '@team9/rabbitmq';
import { PostBroadcastService } from './post-broadcast.service.js';

/**
 * Post-Broadcast Module
 *
 * Handles event-driven post-broadcast tasks:
 * - Offline message storage
 * - Unread count updates
 * - Outbox completion marking
 *
 * Replaces polling-based Outbox processor with event-driven approach.
 */
@Module({
  imports: [DatabaseModule, RedisModule, RabbitmqModule],
  providers: [PostBroadcastService],
  exports: [PostBroadcastService],
})
export class PostBroadcastModule {}
