import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TaskcastServerClient,
  type CreateTaskInput,
} from '@taskcast/server-sdk';

// TaskStatus from @taskcast/core — defined inline to avoid pnpm strict resolution issues
type TaskStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'cancelled';

const STATUS_MAP: Record<string, TaskStatus> = {
  in_progress: 'running',
  paused: 'paused',
  pending_action: 'blocked',
  completed: 'completed',
  failed: 'failed',
  timeout: 'timeout',
  stopped: 'cancelled',
};

@Injectable()
export class TaskCastService {
  private readonly logger = new Logger(TaskCastService.name);
  private readonly client: TaskcastServerClient;

  constructor(config: ConfigService) {
    this.client = new TaskcastServerClient({
      baseUrl: config.get<string>('TASKCAST_URL', 'http://localhost:3721'),
    });
  }

  /**
   * Deterministic ID: `agent_task_exec_${executionId}`.
   * This lets all services compute the TaskCast ID without DB lookups.
   */
  async createTask(params: {
    routineId: string;
    executionId: string;
    botId: string;
    tenantId: string;
    ttl?: number;
  }): Promise<string | null> {
    const deterministicId = TaskCastService.taskcastId(params.executionId);
    try {
      const task = await this.client.createTask({
        id: deterministicId,
        type: `agent_task.${params.routineId}`,
        ttl: params.ttl ?? 86400,
        metadata: {
          routineId: params.routineId,
          executionId: params.executionId,
          botId: params.botId,
          tenantId: params.tenantId,
        },
      } as CreateTaskInput & { id: string });
      return task.id;
    } catch (error) {
      this.logger.error(`Failed to create TaskCast task: ${error}`);
      return null;
    }
  }

  async transitionStatus(
    taskcastTaskId: string,
    status: string,
  ): Promise<void> {
    const mapped = STATUS_MAP[status];
    if (!mapped) {
      this.logger.warn(`No TaskCast mapping for status: ${status}`);
      return;
    }
    try {
      await this.client.transitionTask(taskcastTaskId, mapped);
    } catch (error) {
      this.logger.error(`Failed to transition TaskCast status: ${error}`);
    }
  }

  async publishEvent(
    taskcastTaskId: string,
    event: {
      type: string;
      data: Record<string, unknown>;
      seriesId?: string;
      seriesMode?: 'accumulate' | 'latest' | 'keep-all';
    },
  ): Promise<void> {
    try {
      await this.client.publishEvent(taskcastTaskId, {
        type: event.type,
        level: 'info',
        data: event.data,
        seriesId: event.seriesId,
        seriesMode: event.seriesMode,
      });
    } catch (error) {
      this.logger.error(`Failed to publish TaskCast event: ${error}`);
    }
  }

  /** No-op — TaskCast cleanup rules handle expiration via TTL. */
  async deleteTask(_taskcastTaskId: string): Promise<void> {}

  /** Compute the deterministic TaskCast task ID from an execution ID. */
  static taskcastId(executionId: string): string {
    return `agent_task_exec_${executionId}`;
  }
}
