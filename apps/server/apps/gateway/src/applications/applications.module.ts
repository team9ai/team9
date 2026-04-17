import { Module, forwardRef } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { ChannelsModule } from '../im/channels/channels.module.js';
import { WebsocketModule } from '../im/websocket/websocket.module.js';
import { RedisModule } from '@team9/redis';
import { ClawHiveModule } from '@team9/claw-hive';
import { AiClientModule } from '@team9/ai-client';
import { UsersModule } from '../im/users/users.module.js';
import { ApplicationsController } from './applications.controller.js';
import { ApplicationsService } from './applications.service.js';
import { InstalledApplicationsController } from './installed-applications.controller.js';
import { InstalledApplicationsService } from './installed-applications.service.js';
import { CommonStaffController } from './common-staff.controller.js';
import { CommonStaffService } from './common-staff.service.js';
import { PersonalStaffController } from './personal-staff.controller.js';
import { PersonalStaffService } from './personal-staff.service.js';
import { StaffService } from './staff.service.js';
import {
  APPLICATION_HANDLERS,
  type ApplicationHandler,
} from './handlers/index.js';

@Module({
  imports: [
    forwardRef(() => WorkspaceModule),
    forwardRef(() => ChannelsModule),
    forwardRef(() => WebsocketModule),
    RedisModule,
    ClawHiveModule,
    AiClientModule,
    UsersModule,
  ],
  controllers: [
    ApplicationsController,
    InstalledApplicationsController,
    CommonStaffController,
    PersonalStaffController,
  ],
  providers: [
    ApplicationsService,
    InstalledApplicationsService,
    StaffService,
    CommonStaffService,
    PersonalStaffService,
    // Application handlers
    ...APPLICATION_HANDLERS,
    {
      provide: 'APPLICATION_HANDLERS',
      useFactory: (...handlers: ApplicationHandler[]) => handlers,
      inject: APPLICATION_HANDLERS,
    },
  ],
  exports: [
    ApplicationsService,
    InstalledApplicationsService,
    StaffService,
    CommonStaffService,
    PersonalStaffService,
  ],
})
export class ApplicationsModule {}
