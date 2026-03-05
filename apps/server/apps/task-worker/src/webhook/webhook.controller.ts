import {
  Controller,
  Post,
  Body,
  Inject,
  Logger,
  HttpCode,
} from '@nestjs/common';
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
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  @Post('timeout')
  @HttpCode(200)
  async handleTimeout(@Body() payload: TaskcastTimeoutPayload): Promise<void> {
    const { taskId } = payload;

    this.logger.warn(`Received timeout webhook for task ${taskId}`);

    // Find the current in-progress execution for this task
    const [task] = await this.db
      .select()
      .from(schema.agentTasks)
      .where(eq(schema.agentTasks.id, taskId))
      .limit(1);

    if (!task) {
      this.logger.error(`Task not found for timeout webhook: ${taskId}`);
      return;
    }

    const now = new Date();

    // Update execution status if there is a current execution
    if (task.currentExecutionId) {
      await this.db
        .update(schema.agentTaskExecutions)
        .set({
          status: 'timeout',
          completedAt: now,
        })
        .where(eq(schema.agentTaskExecutions.id, task.currentExecutionId));
    }

    // Update task status to timeout
    await this.db
      .update(schema.agentTasks)
      .set({
        status: 'timeout',
        updatedAt: now,
      })
      .where(eq(schema.agentTasks.id, taskId));

    this.logger.warn(
      `Task ${taskId} and execution ${task.currentExecutionId} marked as timeout via webhook`,
    );
  }
}
