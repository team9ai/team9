import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TaskcastServerClient,
  type CreateTaskInput,
} from '@taskcast/server-sdk';

@Injectable()
export class TaskCastClient {
  private readonly logger = new Logger(TaskCastClient.name);
  private readonly client: TaskcastServerClient;

  constructor(config: ConfigService) {
    this.client = new TaskcastServerClient({
      baseUrl: config.get<string>('TASKCAST_URL', 'http://localhost:3721'),
    });
  }

  /**
   * Deterministic ID: `agent_task_exec_${executionId}`.
   */
  async createTask(params: {
    routineId: string;
    executionId: string;
    botId: string;
    tenantId: string;
    ttl?: number;
  }): Promise<string | null> {
    const deterministicId = `agent_task_exec_${params.executionId}`;
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
}
