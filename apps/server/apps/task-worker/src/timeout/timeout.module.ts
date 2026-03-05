import { Module } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { TimeoutService } from './timeout.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [TimeoutService],
})
export class TimeoutModule {}
