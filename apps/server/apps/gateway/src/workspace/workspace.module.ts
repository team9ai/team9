import { Module } from '@nestjs/common';
import {
  WorkspaceController,
  InvitationsController,
} from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { DatabaseModule } from '@team9/database';

@Module({
  imports: [DatabaseModule],
  controllers: [WorkspaceController, InvitationsController],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
