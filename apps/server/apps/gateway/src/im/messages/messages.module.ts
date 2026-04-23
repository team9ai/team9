import { Module, forwardRef } from '@nestjs/common';
import { RedisModule } from '@team9/redis';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';
import { AuthModule } from '../../auth/auth.module.js';
import { ChannelsModule } from '../channels/channels.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';
import { PropertiesModule } from '../properties/properties.module.js';
import { ImWorkerGrpcClientService } from '../services/im-worker-grpc-client.service.js';
import { StreamingController } from '../streaming/streaming.controller.js';
import { DeepResearchModule } from '../../deep-research/deep-research.module.js';

@Module({
  imports: [
    AuthModule,
    RedisModule,
    DeepResearchModule,
    PropertiesModule,
    forwardRef(() => ChannelsModule),
    forwardRef(() => WebsocketModule),
  ],
  controllers: [MessagesController, StreamingController],
  providers: [MessagesService, ImWorkerGrpcClientService],
  exports: [MessagesService, ImWorkerGrpcClientService],
})
export class MessagesModule {}
