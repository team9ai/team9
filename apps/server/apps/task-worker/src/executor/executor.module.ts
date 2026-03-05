import { Module } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { ExecutorService } from './executor.service.js';
import { OpenclawStrategy } from './strategies/openclaw.strategy.js';

@Module({
  imports: [DatabaseModule],
  providers: [ExecutorService, OpenclawStrategy],
  exports: [ExecutorService],
})
export class ExecutorModule {}
