import { Module } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { ChannelsModule } from '../im/channels/channels.module.js';
import { ApplicationsController } from './applications.controller.js';
import { ApplicationsService } from './applications.service.js';
import { InstalledApplicationsController } from './installed-applications.controller.js';
import { InstalledApplicationsService } from './installed-applications.service.js';
import { APPLICATION_HANDLERS, OpenClawHandler } from './handlers/index.js';

@Module({
  imports: [WorkspaceModule, ChannelsModule],
  controllers: [ApplicationsController, InstalledApplicationsController],
  providers: [
    ApplicationsService,
    InstalledApplicationsService,
    // Application handlers
    ...APPLICATION_HANDLERS,
    {
      provide: 'APPLICATION_HANDLERS',
      useFactory: (...handlers: OpenClawHandler[]) => handlers,
      inject: APPLICATION_HANDLERS,
    },
  ],
  exports: [ApplicationsService, InstalledApplicationsService],
})
export class ApplicationsModule {}
