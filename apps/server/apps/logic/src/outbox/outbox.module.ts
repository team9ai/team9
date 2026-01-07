import { Module } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { RedisModule } from '@team9/redis';
import { RabbitmqModule } from '@team9/rabbitmq';
import { MessageModule } from '../message/message.module.js';
import { OutboxProcessorService } from './outbox-processor.service.js';

@Module({
  imports: [DatabaseModule, RedisModule, RabbitmqModule, MessageModule],
  providers: [OutboxProcessorService],
  exports: [OutboxProcessorService],
})
export class OutboxModule {}
