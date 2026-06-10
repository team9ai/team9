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
import { FileModule } from '../../file/file.module.js';
import { AgentTimelineController } from '../timeline/agent-timeline.controller.js';
import { AgentTimelineService } from '../timeline/agent-timeline.service.js';
import { InternalAuthGuard } from '../../auth/internal-auth.guard.js';
import { ExternalMessagesInternalController } from './external-messages-internal.controller.js';
import { ExternalImMessageRelayService } from './external-im-message-relay.service.js';

@Module({
  imports: [
    AuthModule,
    RedisModule,
    PropertiesModule,
    FileModule,
    forwardRef(() => ChannelsModule),
    forwardRef(() => WebsocketModule),
  ],
  controllers: [
    MessagesController,
    ExternalMessagesInternalController,
    StreamingController,
    AgentTimelineController,
  ],
  providers: [
    MessagesService,
    ImWorkerGrpcClientService,
    AgentTimelineService,
    InternalAuthGuard,
    ExternalImMessageRelayService,
  ],
  exports: [MessagesService, ImWorkerGrpcClientService, AgentTimelineService],
})
export class MessagesModule {}
