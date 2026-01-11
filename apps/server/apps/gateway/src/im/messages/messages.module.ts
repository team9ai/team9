import { Module, forwardRef } from '@nestjs/common';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';
import { AuthModule } from '../../auth/auth.module.js';
import { ChannelsModule } from '../channels/channels.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';
import { ImWorkerGrpcClientService } from '../services/im-worker-grpc-client.service.js';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => ChannelsModule),
    forwardRef(() => WebsocketModule),
  ],
  controllers: [MessagesController],
  providers: [MessagesService, ImWorkerGrpcClientService],
  exports: [MessagesService, ImWorkerGrpcClientService],
})
export class MessagesModule {}
