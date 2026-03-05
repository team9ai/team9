import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  lte,
  sql,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';

/** 24 hours in milliseconds. */
const TIMEOUT_THRESHOLD_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class TimeoutService {
  private readonly logger = new Logger(TimeoutService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Scans every 5 minutes for executions that have been in_progress
   * for longer than 24 hours and marks them as timed out.
   */
  @Interval(300_000)
  async scanTimedOutExecutions(): Promise<void> {
    const cutoff = new Date(Date.now() - TIMEOUT_THRESHOLD_MS);

    const staleExecutions = await this.db
      .select()
      .from(schema.agentTaskExecutions)
      .where(
        and(
          eq(schema.agentTaskExecutions.status, 'in_progress'),
          lte(schema.agentTaskExecutions.startedAt, cutoff),
        ),
      );

    if (staleExecutions.length === 0) {
      return;
    }

    this.logger.warn(
      `Found ${staleExecutions.length} timed-out execution(s), marking as timeout`,
    );

    const now = new Date();

    for (const execution of staleExecutions) {
      try {
        // Update execution status to timeout
        await this.db
          .update(schema.agentTaskExecutions)
          .set({
            status: 'timeout',
            completedAt: now,
          })
          .where(eq(schema.agentTaskExecutions.id, execution.id));

        // Update the parent task status to timeout
        await this.db
          .update(schema.agentTasks)
          .set({
            status: 'timeout',
            updatedAt: now,
          })
          .where(eq(schema.agentTasks.id, execution.taskId));

        this.logger.warn(
          `Execution ${execution.id} for task ${execution.taskId} marked as timeout (started at ${execution.startedAt?.toISOString()})`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to mark execution ${execution.id} as timeout: ${error}`,
        );
      }
    }
  }
}
