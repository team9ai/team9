import { Module } from '@nestjs/common';
import { ExecutorModule } from '../executor/executor.module.js';
import { TaskCommandConsumer } from './task-command.consumer.js';

/**
 * Consumer Module for task-worker
 *
 * Handles task command consumption from RabbitMQ:
 * - Consumes task commands via @RabbitSubscribe decorator
 * - Delegates execution to ExecutorService
 *
 * Note: Queue and exchange setup is handled automatically by @RabbitSubscribe
 * decorator in TaskCommandConsumer
 */
@Module({
  imports: [ExecutorModule],
  providers: [TaskCommandConsumer],
})
export class ConsumerModule {}
