import { Module } from '@nestjs/common';
import {
  WorkspaceController,
  InvitationsController,
} from './workspace.controller.js';
import { WorkspaceService } from './workspace.service.js';
import { DatabaseModule } from '@team9/database';

@Module({
  imports: [DatabaseModule],
  controllers: [WorkspaceController, InvitationsController],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
