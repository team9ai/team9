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
   * Scans every 5 minutes for task runs that have been in_progress
   * for longer than 24 hours and marks them as timed out.
   */
  @Interval(300_000)
  async scanTimedOutExecutions(): Promise<void> {
    const cutoff = new Date(Date.now() - TIMEOUT_THRESHOLD_MS);

    const staleRuns = await this.db
      .select()
      .from(schema.taskRuns)
      .where(
        and(
          eq(schema.taskRuns.status, 'in_progress'),
          lte(schema.taskRuns.startedAt, cutoff),
        ),
      );

    if (staleRuns.length === 0) {
      return;
    }

    this.logger.warn(
      `Found ${staleRuns.length} timed-out task run(s), marking as timeout`,
    );

    const now = new Date();

    for (const run of staleRuns) {
      try {
        const [updated] = await this.db
          .update(schema.taskRuns)
          .set({
            status: 'timeout',
            completedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.taskRuns.id, run.id),
              eq(schema.taskRuns.status, 'in_progress'),
            ),
          )
          .returning();

        if (!updated) {
          this.logger.debug(
            `Task run ${run.id} already transitioned, skipping timeout`,
          );
          continue;
        }

        await this.db
          .update(schema.routineExecutions)
          .set({
            status: 'timeout',
            completedAt: now,
          })
          .where(eq(schema.routineExecutions.id, run.id));

        if (run.routineId) {
          await this.db
            .update(schema.routines)
            .set({
              status: 'timeout',
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.routines.id, run.routineId),
                eq(schema.routines.status, 'in_progress'),
              ),
            );
        }

        this.logger.warn(
          `Task run ${run.id} marked as timeout (routine ${run.routineId ?? 'none'}, started at ${run.startedAt?.toISOString()})`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to mark task run ${run.id} as timeout: ${error}`,
        );
      }
    }
  }
}
