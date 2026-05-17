import { Module } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { RedisModule } from '@team9/redis';
import { RabbitmqModule } from '@team9/rabbitmq';
import { StorageModule } from '@team9/storage';
import { SequenceModule } from '../sequence/sequence.module.js';
import { MessageService } from './message.service.js';
import { MessageRouterService } from './message-router.service.js';
import { MessageGrpcController } from './message.grpc-controller.js';
import { AttachmentThumbnailService } from './attachment-thumbnail.service.js';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    RabbitmqModule,
    SequenceModule,
    StorageModule,
  ],
  controllers: [MessageGrpcController],
  providers: [MessageService, MessageRouterService, AttachmentThumbnailService],
  exports: [MessageService, MessageRouterService],
})
export class MessageModule {}
