import { Module, forwardRef } from '@nestjs/common';
import {
  WorkspaceController,
  InvitationsController,
} from './workspace.controller.js';
import { WorkspaceService } from './workspace.service.js';
import { DatabaseModule } from '@team9/database';
import { RedisModule } from '@team9/redis';
import { WebsocketModule } from '../im/websocket/websocket.module.js';
import { ChannelsModule } from '../im/channels/channels.module.js';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    forwardRef(() => WebsocketModule),
    forwardRef(() => ChannelsModule),
  ],
  controllers: [WorkspaceController, InvitationsController],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
