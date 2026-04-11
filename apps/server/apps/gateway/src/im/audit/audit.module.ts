import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { AuditController } from './audit.controller.js';
import { DatabaseModule } from '@team9/database';
import { WorkspaceModule } from '../../workspace/workspace.module.js';

@Global()
@Module({
  imports: [DatabaseModule, WorkspaceModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
