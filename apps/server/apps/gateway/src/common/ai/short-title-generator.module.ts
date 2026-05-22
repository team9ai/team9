import { Module } from '@nestjs/common';
import { CapabilityHubModule } from '../../capability-hub/capability-hub.module.js';
import { ShortTitleGeneratorService } from './short-title-generator.service.js';

@Module({
  imports: [CapabilityHubModule],
  providers: [ShortTitleGeneratorService],
  exports: [ShortTitleGeneratorService],
})
export class ShortTitleGeneratorModule {}
