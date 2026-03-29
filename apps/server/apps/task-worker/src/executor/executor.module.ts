import { Module, OnModuleInit } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { ClawHiveModule } from '@team9/claw-hive';
import { ExecutorService } from './executor.service.js';
import { OpenclawStrategy } from './strategies/openclaw.strategy.js';
import { HiveStrategy } from './strategies/hive.strategy.js';
import { TaskCastModule } from '../taskcast/taskcast.module.js';

@Module({
  imports: [DatabaseModule, TaskCastModule, ClawHiveModule],
  providers: [ExecutorService, OpenclawStrategy, HiveStrategy],
  exports: [ExecutorService],
})
export class ExecutorModule implements OnModuleInit {
  constructor(
    private readonly executorService: ExecutorService,
    private readonly openclawStrategy: OpenclawStrategy,
    private readonly hiveStrategy: HiveStrategy,
  ) {}

  onModuleInit() {
    this.executorService.registerStrategy('system', this.openclawStrategy);
    this.executorService.registerStrategy('custom', this.openclawStrategy);
    this.executorService.registerStrategy('hive', this.hiveStrategy);
  }
}
