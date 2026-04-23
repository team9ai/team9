import { Module, forwardRef } from '@nestjs/common';
import { TopicSessionsController } from './topic-sessions.controller.js';
import { TopicSessionsService } from './topic-sessions.service.js';
import { AuthModule } from '../../auth/auth.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';
import { ChannelsModule } from '../channels/channels.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { ClawHiveModule } from '@team9/claw-hive';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => WebsocketModule),
    forwardRef(() => ChannelsModule),
    MessagesModule,
    ClawHiveModule,
  ],
  controllers: [TopicSessionsController],
  providers: [TopicSessionsService],
  exports: [TopicSessionsService],
})
export class TopicSessionsModule {}
