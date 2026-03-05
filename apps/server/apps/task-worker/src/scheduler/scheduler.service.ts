import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  lte,
  notInArray,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { ScheduleConfig } from '@team9/database/schemas';
import { ExecutorService } from '../executor/executor.service.js';

/** Statuses that should NOT be picked up by the scheduler. */
const EXCLUDED_STATUSES: (typeof schema.agentTaskStatusEnum.enumValues)[number][] =
  ['stopped', 'paused', 'in_progress', 'pending_action'];

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly executor: ExecutorService,
  ) {}

  /**
   * Runs every 30 seconds to find recurring tasks that are due for execution.
   */
  @Interval(30_000)
  async scanRecurringTasks(): Promise<void> {
    const now = new Date();

    const dueTasks = await this.db
      .select()
      .from(schema.agentTasks)
      .where(
        and(
          eq(schema.agentTasks.scheduleType, 'recurring'),
          lte(schema.agentTasks.nextRunAt, now),
          notInArray(schema.agentTasks.status, EXCLUDED_STATUSES),
        ),
      );

    if (dueTasks.length === 0) {
      return;
    }

    this.logger.log(
      `Found ${dueTasks.length} recurring task(s) due for execution`,
    );

    for (const task of dueTasks) {
      try {
        await this.executor.triggerExecution(task.id);

        // Calculate and persist the next run time
        const nextRunAt = calculateNextRunAt(task.scheduleConfig ?? undefined);

        if (nextRunAt) {
          await this.db
            .update(schema.agentTasks)
            .set({ nextRunAt, updatedAt: new Date() })
            .where(eq(schema.agentTasks.id, task.id));

          this.logger.log(
            `Task ${task.id} next run scheduled for ${nextRunAt.toISOString()}`,
          );
        } else {
          this.logger.warn(
            `Task ${task.id} has no valid schedule config; cannot compute next run`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed to trigger execution for task ${task.id}: ${error}`,
        );
      }
    }
  }
}

// ── Helper ──────────────────────────────────────────────────────────────

/**
 * Calculate the next run time based on a recurring schedule configuration.
 *
 * Supported frequencies:
 *  - daily   — runs every day at `config.time` (HH:mm)
 *  - weekly  — runs every week on `config.dayOfWeek` (0 = Sunday) at `config.time`
 *  - monthly — runs every month on `config.dayOfMonth` (1-31) at `config.time`
 *
 * Returns `null` if the config is missing or has an unsupported frequency.
 */
export function calculateNextRunAt(config?: ScheduleConfig): Date | null {
  if (!config?.frequency) {
    return null;
  }

  const now = new Date();
  const [hours, minutes] = parseTime(config.time);

  switch (config.frequency) {
    case 'daily':
      return nextDaily(now, hours, minutes);

    case 'weekly':
      return nextWeekly(now, hours, minutes, config.dayOfWeek ?? 1);

    case 'monthly':
      return nextMonthly(now, hours, minutes, config.dayOfMonth ?? 1);

    default:
      return null;
  }
}

/**
 * Parse an "HH:mm" time string. Defaults to 00:00 on invalid input.
 */
function parseTime(time?: string): [number, number] {
  if (!time) return [0, 0];
  const parts = time.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return [isNaN(h) ? 0 : h, isNaN(m) ? 0 : m];
}

/**
 * Next daily occurrence at the given time.
 * If today's slot has already passed, schedule for tomorrow.
 */
function nextDaily(now: Date, hours: number, minutes: number): Date {
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

/**
 * Next weekly occurrence on the given day-of-week at the given time.
 */
function nextWeekly(
  now: Date,
  hours: number,
  minutes: number,
  dayOfWeek: number,
): Date {
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);

  // Calculate days until the target day of the week
  const currentDay = next.getDay();
  let daysUntil = (dayOfWeek - currentDay + 7) % 7;

  // If it's the same day but the time has passed, schedule for next week
  if (daysUntil === 0 && next <= now) {
    daysUntil = 7;
  }

  next.setDate(next.getDate() + daysUntil);
  return next;
}

/**
 * Next monthly occurrence on the given day-of-month at the given time.
 * Clamps to the last day of the month when the target day exceeds the month length.
 */
function nextMonthly(
  now: Date,
  hours: number,
  minutes: number,
  dayOfMonth: number,
): Date {
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);

  // Try this month first
  const lastDayThisMonth = new Date(
    next.getFullYear(),
    next.getMonth() + 1,
    0,
  ).getDate();
  next.setDate(Math.min(dayOfMonth, lastDayThisMonth));

  if (next <= now) {
    // Move to next month
    next.setMonth(next.getMonth() + 1);
    const lastDayNextMonth = new Date(
      next.getFullYear(),
      next.getMonth() + 1,
      0,
    ).getDate();
    next.setDate(Math.min(dayOfMonth, lastDayNextMonth));
  }

  return next;
}
