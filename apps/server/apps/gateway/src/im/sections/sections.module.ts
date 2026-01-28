import { Module } from '@nestjs/common';
import { SectionsService } from './sections.service.js';
import {
  SectionsController,
  ChannelSectionController,
} from './sections.controller.js';
import { DatabaseModule } from '@team9/database';
import { WorkspaceModule } from '../../workspace/workspace.module.js';

@Module({
  imports: [DatabaseModule, WorkspaceModule],
  controllers: [SectionsController, ChannelSectionController],
  providers: [SectionsService],
  exports: [SectionsService],
})
export class SectionsModule {}
