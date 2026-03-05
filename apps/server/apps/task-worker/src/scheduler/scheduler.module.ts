import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '@team9/database';
import { ExecutorModule } from '../executor/executor.module.js';
import { SchedulerService } from './scheduler.service.js';

@Module({
  imports: [ScheduleModule.forRoot(), DatabaseModule, ExecutorModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
