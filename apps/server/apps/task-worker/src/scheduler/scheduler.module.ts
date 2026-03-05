import { Module } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { ExecutorModule } from '../executor/executor.module.js';
import { SchedulerService } from './scheduler.service.js';

@Module({
  imports: [DatabaseModule, ExecutorModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
