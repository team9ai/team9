import {
  Controller,
  Post,
  Body,
  Inject,
  Headers,
  Logger,
  HttpCode,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DATABASE_CONNECTION,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';

interface TaskcastTimeoutPayload {
  taskId: string;
  status: string;
}

@Controller('webhooks/taskcast')
export class WebhookController {
  private static readonly TASKCAST_ID_PREFIX = 'agent_task_exec_';
  private readonly logger = new Logger(WebhookController.name);
  private readonly webhookSecret: string | undefined;

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    configService: ConfigService,
  ) {
    this.webhookSecret = configService.get<string>('TASKCAST_WEBHOOK_SECRET');
  }

  @Post('timeout')
  @HttpCode(200)
  async handleTimeout(
    @Body() payload: TaskcastTimeoutPayload,
    @Headers('x-webhook-secret') secret?: string,
  ): Promise<void> {
    if (this.webhookSecret && secret !== this.webhookSecret) {
      throw new ForbiddenException('Invalid webhook secret');
    }
    const { taskId: taskcastId } = payload;

    this.logger.warn(
      `Received timeout webhook for TaskCast task ${taskcastId}`,
    );

    // Parse execution ID from deterministic TaskCast ID (agent_task_exec_{execId})
    if (!taskcastId.startsWith(WebhookController.TASKCAST_ID_PREFIX)) {
      this.logger.error(`Unexpected TaskCast ID format: ${taskcastId}`);
      return;
    }
    const executionId = taskcastId.slice(
      WebhookController.TASKCAST_ID_PREFIX.length,
    );

    // Verify execution exists and get its taskId
    const [execution] = await this.db
      .select({
        id: schema.agentTaskExecutions.id,
        taskId: schema.agentTaskExecutions.taskId,
      })
      .from(schema.agentTaskExecutions)
      .where(eq(schema.agentTaskExecutions.id, executionId))
      .limit(1);

    if (!execution) {
      this.logger.error(`Execution not found: ${executionId}`);
      return;
    }

    const now = new Date();

    // Update execution status
    await this.db
      .update(schema.agentTaskExecutions)
      .set({
        status: 'timeout',
        completedAt: now,
      })
      .where(eq(schema.agentTaskExecutions.id, executionId));

    // Update task status to timeout
    await this.db
      .update(schema.agentTasks)
      .set({
        status: 'timeout',
        updatedAt: now,
      })
      .where(eq(schema.agentTasks.id, execution.taskId));

    this.logger.warn(
      `Task ${execution.taskId} and execution ${executionId} marked as timeout via webhook`,
    );
  }
}
