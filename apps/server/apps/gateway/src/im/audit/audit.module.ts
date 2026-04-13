import { Global, Module, forwardRef } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { AuditController } from './audit.controller.js';
import { DatabaseModule } from '@team9/database';
import { WorkspaceModule } from '../../workspace/workspace.module.js';
import { ChannelsModule } from '../channels/channels.module.js';

@Global()
@Module({
  imports: [DatabaseModule, WorkspaceModule, forwardRef(() => ChannelsModule)],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
