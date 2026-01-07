import { Module } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { RedisModule } from '@team9/redis';
import { RabbitmqModule } from '@team9/rabbitmq';
import { SequenceModule } from '../sequence/sequence.module.js';
import { MessageService } from './message.service.js';
import { MessageRouterService } from './message-router.service.js';
import { MessageController } from './message.controller.js';

@Module({
  imports: [DatabaseModule, RedisModule, RabbitmqModule, SequenceModule],
  controllers: [MessageController],
  providers: [MessageService, MessageRouterService],
  exports: [MessageService, MessageRouterService],
})
export class MessageModule {}
