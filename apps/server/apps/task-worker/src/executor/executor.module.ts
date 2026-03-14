import { Module, OnModuleInit } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { ExecutorService } from './executor.service.js';
import { OpenclawStrategy } from './strategies/openclaw.strategy.js';
import { TaskCastModule } from '../taskcast/taskcast.module.js';

@Module({
  imports: [DatabaseModule, TaskCastModule],
  providers: [ExecutorService, OpenclawStrategy],
  exports: [ExecutorService],
})
export class ExecutorModule implements OnModuleInit {
  constructor(
    private readonly executorService: ExecutorService,
    private readonly openclawStrategy: OpenclawStrategy,
  ) {}

  onModuleInit() {
    this.executorService.registerStrategy('system', this.openclawStrategy);
  }
}
