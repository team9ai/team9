import { Module, forwardRef } from '@nestjs/common';
import { RedisModule } from '@team9/redis';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';
import { ForwardsService } from './forwards/forwards.service.js';
import { ForwardsController } from './forwards/forwards.controller.js';
import { AuthModule } from '../../auth/auth.module.js';
import { ChannelsModule } from '../channels/channels.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';
import { PropertiesModule } from '../properties/properties.module.js';
import { ImWorkerGrpcClientService } from '../services/im-worker-grpc-client.service.js';
import { StreamingController } from '../streaming/streaming.controller.js';

@Module({
  imports: [
    AuthModule,
    RedisModule,
    PropertiesModule,
    forwardRef(() => ChannelsModule),
    forwardRef(() => WebsocketModule),
  ],
  controllers: [MessagesController, StreamingController, ForwardsController],
  providers: [MessagesService, ImWorkerGrpcClientService, ForwardsService],
  exports: [MessagesService, ImWorkerGrpcClientService, ForwardsService],
})
export class MessagesModule {}
