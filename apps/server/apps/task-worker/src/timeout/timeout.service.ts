import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  lte,
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
      .from(schema.routineExecutions)
      .where(
        and(
          eq(schema.routineExecutions.status, 'in_progress'),
          lte(schema.routineExecutions.startedAt, cutoff),
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
        // Update execution status to timeout (only if still in_progress)
        const [updated] = await this.db
          .update(schema.routineExecutions)
          .set({
            status: 'timeout',
            completedAt: now,
          })
          .where(
            and(
              eq(schema.routineExecutions.id, execution.id),
              eq(schema.routineExecutions.status, 'in_progress'),
            ),
          )
          .returning();

        if (!updated) {
          this.logger.debug(
            `Execution ${execution.id} already transitioned, skipping timeout`,
          );
          continue;
        }

        // Update the parent task status to timeout
        await this.db
          .update(schema.routines)
          .set({
            status: 'timeout',
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.routines.id, execution.routineId),
              eq(schema.routines.status, 'in_progress'),
            ),
          );

        this.logger.warn(
          `Execution ${execution.id} for routine ${execution.routineId} marked as timeout (started at ${execution.startedAt?.toISOString()})`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to mark execution ${execution.id} as timeout: ${error}`,
        );
      }
    }
  }
}
