import { Module } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { ApplicationsController } from './applications.controller.js';
import { ApplicationsService } from './applications.service.js';
import { InstalledApplicationsController } from './installed-applications.controller.js';
import { InstalledApplicationsService } from './installed-applications.service.js';

@Module({
  imports: [WorkspaceModule],
  controllers: [ApplicationsController, InstalledApplicationsController],
  providers: [ApplicationsService, InstalledApplicationsService],
  exports: [ApplicationsService, InstalledApplicationsService],
})
export class ApplicationsModule {}
