import { Module, OnModuleInit } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { ExecutorService } from './executor.service.js';
import { OpenclawStrategy } from './strategies/openclaw.strategy.js';

@Module({
  imports: [DatabaseModule],
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
