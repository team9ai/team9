import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TaskCastService {
  private readonly logger = new Logger(TaskCastService.name);
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>(
      'TASKCAST_URL',
      'http://localhost:3721',
    );
  }

  /** Create a TaskCast task for an execution */
  async createTask(params: {
    taskId: string;
    executionId: string;
    botId: string;
    tenantId: string;
    ttl?: number;
  }): Promise<string> {
    this.logger.log(
      `Creating TaskCast task for execution ${params.executionId}`,
    );
    // TODO: POST ${baseUrl}/tasks with actual TaskCast SDK when available
    return `tc_${params.executionId}`;
  }

  /** Transition TaskCast task status */
  async updateStatus(taskcastTaskId: string, status: string): Promise<void> {
    this.logger.log(`TaskCast status → ${status} for ${taskcastTaskId}`);
    // TODO: PATCH ${baseUrl}/tasks/${taskcastTaskId}/status
  }

  /** Publish an event to TaskCast */
  async publishEvent(
    taskcastTaskId: string,
    event: {
      type: string;
      data: Record<string, unknown>;
      seriesId?: string;
    },
  ): Promise<void> {
    this.logger.log(`TaskCast event: ${event.type} for ${taskcastTaskId}`);
    // TODO: POST ${baseUrl}/tasks/${taskcastTaskId}/events
  }

  /** Delete / cleanup a TaskCast task */
  async deleteTask(taskcastTaskId: string): Promise<void> {
    this.logger.log(`TaskCast delete: ${taskcastTaskId}`);
    // TODO: DELETE ${baseUrl}/tasks/${taskcastTaskId}
  }
}
