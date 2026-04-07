import { Module, forwardRef, type OnModuleInit, Logger } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { ChannelsModule } from '../im/channels/channels.module.js';
import { WebsocketModule } from '../im/websocket/websocket.module.js';
import { RedisModule } from '@team9/redis';
import { ClawHiveModule } from '@team9/claw-hive';
import { AiClientModule } from '@team9/ai-client';
import { ApplicationsController } from './applications.controller.js';
import { ApplicationsService } from './applications.service.js';
import { InstalledApplicationsController } from './installed-applications.controller.js';
import { InstalledApplicationsService } from './installed-applications.service.js';
import { CommonStaffController } from './common-staff.controller.js';
import { CommonStaffService } from './common-staff.service.js';
import { StaffService } from './staff.service.js';
import {
  APPLICATION_HANDLERS,
  type ApplicationHandler,
} from './handlers/index.js';

@Module({
  imports: [
    forwardRef(() => WorkspaceModule),
    ChannelsModule,
    forwardRef(() => WebsocketModule),
    RedisModule,
    ClawHiveModule,
    AiClientModule,
  ],
  controllers: [
    ApplicationsController,
    InstalledApplicationsController,
    CommonStaffController,
  ],
  providers: [
    ApplicationsService,
    InstalledApplicationsService,
    StaffService,
    CommonStaffService,
    // Application handlers
    ...APPLICATION_HANDLERS,
    {
      provide: 'APPLICATION_HANDLERS',
      useFactory: (...handlers: ApplicationHandler[]) => handlers,
      inject: APPLICATION_HANDLERS,
    },
  ],
  exports: [ApplicationsService, InstalledApplicationsService, StaffService],
})
export class ApplicationsModule implements OnModuleInit {
  private readonly logger = new Logger(ApplicationsModule.name);

  constructor(
    private readonly installedApplicationsService: InstalledApplicationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.installedApplicationsService.backfillAutoInstallApps();
    } catch (error) {
      this.logger.warn('Auto-install backfill failed (non-fatal)', error);
    }
  }
}
