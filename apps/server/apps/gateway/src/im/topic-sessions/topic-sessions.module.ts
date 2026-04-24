import { Module, forwardRef } from '@nestjs/common';
import { TopicSessionsController } from './topic-sessions.controller.js';
import { TopicSessionsService } from './topic-sessions.service.js';
import { TopicTitleGeneratorService } from './topic-title-generator.service.js';
import { AuthModule } from '../../auth/auth.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';
import { ChannelsModule } from '../channels/channels.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { DeepResearchModule } from '../../deep-research/deep-research.module.js';
import { ClawHiveModule } from '@team9/claw-hive';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => WebsocketModule),
    forwardRef(() => ChannelsModule),
    MessagesModule,
    // Brings CapabilityHubClient into scope so TopicTitleGeneratorService
    // can proxy title-generation LLM calls through capability-hub's
    // pre-authorize → record → billing-hub pipeline, same as every
    // other LLM call in the system.
    DeepResearchModule,
    ClawHiveModule,
  ],
  controllers: [TopicSessionsController],
  // TopicTitleGeneratorService listens on `message.created` (EventEmitter2)
  // and auto-generates a short title the first time a bot replies in a
  // topic-session channel. It mutates channel.name too, so the existing
  // search indexer picks it up without any extra plumbing.
  providers: [TopicSessionsService, TopicTitleGeneratorService],
  exports: [TopicSessionsService],
})
export class TopicSessionsModule {}
