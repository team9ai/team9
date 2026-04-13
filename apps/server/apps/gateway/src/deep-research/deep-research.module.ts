import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { CapabilityHubClient } from './capability-hub.client.js';
import { DeepResearchController } from './deep-research.controller.js';

@Module({
  imports: [AuthModule, forwardRef(() => WorkspaceModule)],
  controllers: [DeepResearchController],
  providers: [CapabilityHubClient],
  exports: [CapabilityHubClient],
})
export class DeepResearchModule {}
