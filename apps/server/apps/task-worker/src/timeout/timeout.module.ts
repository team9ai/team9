import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '@team9/database';
import { TimeoutService } from './timeout.service.js';

@Module({
  imports: [ScheduleModule.forRoot(), DatabaseModule],
  providers: [TimeoutService],
})
export class TimeoutModule {}
