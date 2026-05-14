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

    // Parse run ID from deterministic TaskCast ID (agent_task_exec_{runId})
    if (!taskcastId.startsWith(WebhookController.TASKCAST_ID_PREFIX)) {
      this.logger.error(`Unexpected TaskCast ID format: ${taskcastId}`);
      return;
    }
    const runId = taskcastId.slice(WebhookController.TASKCAST_ID_PREFIX.length);

    // Verify run exists and get its optional routineId
    const [run] = await this.db
      .select({
        id: schema.taskRuns.id,
        routineId: schema.taskRuns.routineId,
      })
      .from(schema.taskRuns)
      .where(eq(schema.taskRuns.id, runId))
      .limit(1);

    if (!run) {
      this.logger.error(`Task run not found: ${runId}`);
      return;
    }

    const now = new Date();

    // Update task run status
    await this.db
      .update(schema.taskRuns)
      .set({
        status: 'timeout',
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.taskRuns.id, runId));

    // Keep legacy routine execution rows in sync for routine APIs.
    await this.db
      .update(schema.routineExecutions)
      .set({
        status: 'timeout',
        completedAt: now,
      })
      .where(eq(schema.routineExecutions.id, runId));

    if (run.routineId) {
      await this.db
        .update(schema.routines)
        .set({
          status: 'timeout',
          updatedAt: now,
        })
        .where(eq(schema.routines.id, run.routineId));
    }

    this.logger.warn(
      `Task run ${runId} marked as timeout via webhook (routine ${run.routineId ?? 'none'})`,
    );
  }
}
