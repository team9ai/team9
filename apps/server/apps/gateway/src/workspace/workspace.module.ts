import { Module, forwardRef } from '@nestjs/common';
import {
  WorkspaceController,
  InvitationsController,
} from './workspace.controller.js';
import { WorkspaceService } from './workspace.service.js';
import { WorkspaceGuard } from './guards/workspace.guard.js';
import { WorkspaceRoleGuard } from './guards/workspace-role.guard.js';
import { DatabaseModule } from '@team9/database';
import { RedisModule } from '@team9/redis';
import { WebsocketModule } from '../im/websocket/websocket.module.js';
import { ChannelsModule } from '../im/channels/channels.module.js';
import { ApplicationsModule } from '../applications/applications.module.js';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    forwardRef(() => WebsocketModule),
    forwardRef(() => ChannelsModule),
    forwardRef(() => ApplicationsModule),
  ],
  controllers: [WorkspaceController, InvitationsController],
  providers: [WorkspaceService, WorkspaceGuard, WorkspaceRoleGuard],
  exports: [WorkspaceService, WorkspaceGuard, WorkspaceRoleGuard],
})
export class WorkspaceModule {}
