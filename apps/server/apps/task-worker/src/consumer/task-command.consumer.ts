import { Injectable, Logger } from '@nestjs/common';
import {
  RabbitSubscribe,
  Nack,
  RABBITMQ_EXCHANGES,
  RABBITMQ_QUEUES,
  RABBITMQ_ROUTING_KEYS,
} from '@team9/rabbitmq';
import { MQ_EXCHANGES } from '@team9/shared';
import { ExecutorService } from '../executor/executor.service.js';

export interface TaskCommand {
  type: 'start' | 'pause' | 'resume' | 'stop' | 'restart' | 'retry';
  taskId: string;
  userId: string;
  message?: string;
  notes?: string;
  triggerId?: string;
  sourceExecutionId?: string;
}

/**
 * Task Command Consumer - consumes task commands from RabbitMQ
 *
 * Handles task lifecycle commands published by the Gateway service:
 * - start / restart: trigger a new execution via ExecutorService
 * - pause / resume / stop: delegate to ExecutorService (TODO)
 */
@Injectable()
export class TaskCommandConsumer {
  private readonly logger = new Logger(TaskCommandConsumer.name);

  constructor(private readonly executor: ExecutorService) {}

  @RabbitSubscribe({
    exchange: RABBITMQ_EXCHANGES.TASK_COMMANDS,
    routingKey: RABBITMQ_ROUTING_KEYS.TASK_COMMAND,
    queue: RABBITMQ_QUEUES.TASK_WORKER_COMMANDS,
    queueOptions: {
      durable: true,
      deadLetterExchange: MQ_EXCHANGES.IM_DLX,
      deadLetterRoutingKey: 'dlq.task-command',
    },
    errorHandler: (_channel, _msg, error) => {
      console.error(`[TaskCommandConsumer] Error processing command: ${error}`);
    },
  })
  async handleCommand(command: TaskCommand): Promise<void | Nack> {
    try {
      this.logger.log(
        `Received task command: ${command.type} for task ${command.taskId} from user ${command.userId}`,
      );

      switch (command.type) {
        case 'start':
        case 'restart':
          await this.executor.triggerExecution(command.taskId, {
            triggerId: command.triggerId,
            triggerType: 'manual',
            triggerContext: {
              triggeredAt: new Date().toISOString(),
              triggeredBy: command.userId,
              notes: command.notes,
            },
          });
          break;
        case 'retry':
          await this.executor.triggerExecution(command.taskId, {
            triggerType: 'retry',
            triggerContext: {
              triggeredAt: new Date().toISOString(),
              triggeredBy: command.userId,
              notes: command.notes,
              originalExecutionId: command.sourceExecutionId ?? '',
            },
            sourceExecutionId: command.sourceExecutionId,
          });
          break;
        case 'pause':
          // TODO: delegate to executor.pauseExecution
          this.logger.warn(
            `Pause not yet implemented for task ${command.taskId}`,
          );
          break;
        case 'resume':
          // TODO: delegate to executor.resumeExecution
          this.logger.warn(
            `Resume not yet implemented for task ${command.taskId}`,
          );
          break;
        case 'stop':
          await this.executor.stopExecution(command.taskId);
          break;
        default:
          this.logger.warn(`Unknown task command type: ${command.type}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to process task command ${command.type} for task ${command.taskId}: ${error}`,
      );
      // Nack without requeue - message will go to DLX
      return new Nack(false);
    }
  }
}
