import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CapabilityHubClient } from './capability-hub.client.js';
import { DeepResearchController } from './deep-research.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [DeepResearchController],
  providers: [CapabilityHubClient],
  exports: [CapabilityHubClient],
})
export class DeepResearchModule {}
