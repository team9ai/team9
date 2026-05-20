import { Module, forwardRef } from '@nestjs/common';
import { CapabilityHubModule } from '../../capability-hub/capability-hub.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { ChannelsModule } from '../channels/channels.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';
import { DeepResearchSessionsController } from './deep-research-sessions.controller.js';
import { DeepResearchSessionsService } from './deep-research-sessions.service.js';

@Module({
  imports: [
    AuthModule,
    CapabilityHubModule,
    forwardRef(() => ChannelsModule),
    MessagesModule,
    forwardRef(() => WebsocketModule),
  ],
  controllers: [DeepResearchSessionsController],
  providers: [DeepResearchSessionsService],
  exports: [DeepResearchSessionsService],
})
export class DeepResearchSessionsModule {}
