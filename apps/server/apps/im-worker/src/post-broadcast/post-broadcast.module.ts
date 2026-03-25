import { Module } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { RedisModule } from '@team9/redis';
import { RabbitmqModule } from '@team9/rabbitmq';
import { ClawHiveModule } from '@team9/claw-hive';
import { MessageModule } from '../message/message.module.js';
import { SequenceModule } from '../sequence/sequence.module.js';
import { PostBroadcastService } from './post-broadcast.service.js';

/**
 * Post-Broadcast Module
 *
 * Handles event-driven post-broadcast tasks:
 * - Unread count updates
 * - Outbox completion marking
 *
 * Note: Offline message storage removed - using SeqId-based incremental sync.
 * Messages are synced when user opens a channel via GET /v1/im/sync/channel/:channelId
 */
@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    RabbitmqModule,
    ClawHiveModule,
    MessageModule,
    SequenceModule,
  ],
  providers: [PostBroadcastService],
  exports: [PostBroadcastService],
})
export class PostBroadcastModule {}
