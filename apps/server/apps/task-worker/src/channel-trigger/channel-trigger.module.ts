import { Module } from '@nestjs/common';
import { ChannelTriggerService } from './channel-trigger.service.js';
import { ExecutorModule } from '../executor/executor.module.js';

@Module({
  imports: [ExecutorModule],
  providers: [ChannelTriggerService],
  exports: [ChannelTriggerService],
})
export class ChannelTriggerModule {}
