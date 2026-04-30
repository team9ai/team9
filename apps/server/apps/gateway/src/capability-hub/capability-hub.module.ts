import { Module } from '@nestjs/common';
import { CapabilityHubClient } from './capability-hub.client.js';

@Module({
  providers: [CapabilityHubClient],
  exports: [CapabilityHubClient],
})
export class CapabilityHubModule {}
