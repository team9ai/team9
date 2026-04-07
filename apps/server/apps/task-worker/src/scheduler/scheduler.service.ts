import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  lte,
  inArray,
  notInArray,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { ScheduleConfig } from '@team9/database/schemas';
import { RedisService } from '@team9/redis';
import { ExecutorService } from '../executor/executor.service.js';

/** Statuses that should NOT be picked up by the scheduler. */
const EXCLUDED_STATUSES: (typeof schema.routineStatusEnum.enumValues)[number][] =
  ['stopped', 'paused', 'in_progress', 'pending_action'];

const SCHEDULER_LOCK_KEY = 'task-scheduler:scan-lock';
const SCHEDULER_LOCK_TTL = 25; // seconds — shorter than the 30s interval

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly executor: ExecutorService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Runs every 30 seconds to find recurring tasks that are due for execution.
   * Uses a Redis lock to prevent duplicate execution across multiple instances.
   */
  @Interval(30_000)
  async scanRecurringTasks(): Promise<void> {
    const acquired = await this.acquireLock();
    if (!acquired) {
      this.logger.debug('Another instance holds the scheduler lock, skipping');
      return;
    }

    try {
      await this.doScan();
    } finally {
      await this.releaseLock();
    }
  }

  private async doScan(): Promise<void> {
    const now = new Date();

    const dueTriggers = await this.db
      .select({
        trigger: schema.routineTriggers,
        routineStatus: schema.routines.status,
      })
      .from(schema.routineTriggers)
      .innerJoin(
        schema.routines,
        eq(schema.routineTriggers.routineId, schema.routines.id),
      )
      .where(
        and(
          eq(schema.routineTriggers.enabled, true),
          inArray(schema.routineTriggers.type, ['interval', 'schedule']),
          lte(schema.routineTriggers.nextRunAt, now),
          notInArray(schema.routines.status, EXCLUDED_STATUSES),
        ),
      );

    if (dueTriggers.length === 0) {
      return;
    }

    this.logger.log(`Found ${dueTriggers.length} trigger(s) due for execution`);

    for (const { trigger } of dueTriggers) {
      try {
        const triggerContext = {
          triggeredAt: new Date().toISOString(),
          scheduledAt:
            trigger.nextRunAt?.toISOString() ?? new Date().toISOString(),
        };

        await this.executor.triggerExecution(trigger.routineId, {
          triggerId: trigger.id,
          triggerType: trigger.type,
          triggerContext,
        });

        // Calculate and persist the next run time based on trigger type and config
        const nextRunAt = this.calculateNextRunForTrigger(trigger);

        await this.db
          .update(schema.routineTriggers)
          .set({
            nextRunAt,
            lastRunAt: now,
            updatedAt: now,
          })
          .where(eq(schema.routineTriggers.id, trigger.id));

        if (nextRunAt) {
          this.logger.log(
            `Trigger ${trigger.id} next run scheduled for ${nextRunAt.toISOString()}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed to trigger execution for trigger ${trigger.id}: ${error}`,
        );
      }
    }
  }

  private calculateNextRunForTrigger(
    trigger: schema.RoutineTrigger,
  ): Date | null {
    const config = trigger.config as Record<string, unknown> | null;
    if (!config) return null;

    if (trigger.type === 'interval') {
      return calculateNextRunAtForInterval(
        config as { every: number; unit: string },
      );
    }

    if (trigger.type === 'schedule') {
      return calculateNextRunAt(config as ScheduleConfig);
    }

    return null;
  }

  private lockValue = `${process.pid}-${Date.now()}`;

  private async acquireLock(): Promise<boolean> {
    const client = this.redis.getClient();
    const result = await client.set(
      SCHEDULER_LOCK_KEY,
      this.lockValue,
      'EX',
      SCHEDULER_LOCK_TTL,
      'NX',
    );
    return result === 'OK';
  }

  private async releaseLock(): Promise<void> {
    // Only release if we still own the lock (Lua script for atomicity)
    const client = this.redis.getClient();
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    try {
      await client.eval(script, 1, SCHEDULER_LOCK_KEY, this.lockValue);
    } catch (error) {
      this.logger.warn(`Failed to release scheduler lock: ${error}`);
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
 * When `config.timezone` is set (IANA timezone, e.g. "Asia/Shanghai"),
 * the time is interpreted in that timezone and the returned Date is UTC.
 *
 * Returns `null` if the config is missing or has an unsupported frequency.
 */
export function calculateNextRunAt(config?: ScheduleConfig): Date | null {
  if (!config?.frequency) {
    return null;
  }

  const tz = config.timezone || undefined;
  const now = new Date();
  const [hours, minutes] = parseTime(config.time);

  switch (config.frequency) {
    case 'daily':
      return nextDaily(now, hours, minutes, tz);

    case 'weekly':
      return nextWeekly(now, hours, minutes, config.dayOfWeek ?? 1, tz);

    case 'weekdays':
      return nextWeekday(now, hours, minutes, tz);

    case 'monthly':
      return nextMonthly(now, hours, minutes, config.dayOfMonth ?? 1, tz);

    case 'yearly':
      return nextYearly(now, hours, minutes, config.dayOfMonth ?? 1, tz);

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
 * Get the UTC offset in minutes for a given IANA timezone at a specific date.
 * Uses the Intl API (no external deps). Returns 0 for invalid timezones.
 */
function getTimezoneOffsetMinutes(date: Date, tz: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const get = (type: string) =>
      parseInt(parts.find((p) => p.type === type)!.value, 10);

    const tzTime = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    );
    // Difference = how far the tz local time is ahead of UTC
    return Math.round((tzTime - date.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

/**
 * Build a UTC Date for a target local time in a given timezone.
 * If no timezone is provided, uses the server's local time.
 */
function buildDateInTz(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  tz?: string,
): Date {
  if (!tz) {
    const d = new Date(year, month, day, hours, minutes, 0, 0);
    return d;
  }
  // Construct as if UTC, then subtract the tz offset to get real UTC
  const utcGuess = new Date(Date.UTC(year, month, day, hours, minutes, 0, 0));
  const offset = getTimezoneOffsetMinutes(utcGuess, tz);
  return new Date(utcGuess.getTime() - offset * 60_000);
}

/**
 * Get "now" components in either a specific timezone or server-local.
 */
function nowInTz(
  now: Date,
  tz?: string,
): { year: number; month: number; day: number; weekday: number } {
  if (!tz) {
    return {
      year: now.getFullYear(),
      month: now.getMonth(),
      day: now.getDate(),
      weekday: now.getDay(),
    };
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10) - 1,
    day: parseInt(get('day'), 10),
    weekday: weekdayMap[get('weekday')] ?? 0,
  };
}

/**
 * Next daily occurrence at the given time.
 * If today's slot has already passed, schedule for tomorrow.
 */
function nextDaily(
  now: Date,
  hours: number,
  minutes: number,
  tz?: string,
): Date {
  const n = nowInTz(now, tz);
  const next = buildDateInTz(n.year, n.month, n.day, hours, minutes, tz);

  if (next <= now) {
    const tomorrow = buildDateInTz(
      n.year,
      n.month,
      n.day + 1,
      hours,
      minutes,
      tz,
    );
    return tomorrow;
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
  tz?: string,
): Date {
  const n = nowInTz(now, tz);
  let daysUntil = (dayOfWeek - n.weekday + 7) % 7;

  const candidate = buildDateInTz(
    n.year,
    n.month,
    n.day + daysUntil,
    hours,
    minutes,
    tz,
  );

  if (daysUntil === 0 && candidate <= now) {
    daysUntil = 7;
    return buildDateInTz(
      n.year,
      n.month,
      n.day + daysUntil,
      hours,
      minutes,
      tz,
    );
  }

  return candidate;
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
  tz?: string,
): Date {
  const n = nowInTz(now, tz);

  // Try this month first
  const lastDayThisMonth = new Date(n.year, n.month + 1, 0).getDate();
  const clampedDay = Math.min(dayOfMonth, lastDayThisMonth);
  const next = buildDateInTz(n.year, n.month, clampedDay, hours, minutes, tz);

  if (next <= now) {
    // Move to next month
    const nextMonth = n.month + 1;
    const nextYear = n.year;
    const lastDayNextMonth = new Date(nextYear, nextMonth + 1, 0).getDate();
    const clampedNextDay = Math.min(dayOfMonth, lastDayNextMonth);
    return buildDateInTz(
      nextYear,
      nextMonth,
      clampedNextDay,
      hours,
      minutes,
      tz,
    );
  }

  return next;
}

/**
 * Next yearly occurrence on the same month/day at the given time.
 * Uses dayOfMonth for the day; month is preserved from the current date.
 */
function nextYearly(
  now: Date,
  hours: number,
  minutes: number,
  dayOfMonth: number,
  tz?: string,
): Date {
  const n = nowInTz(now, tz);
  const next = buildDateInTz(n.year, n.month, dayOfMonth, hours, minutes, tz);

  if (next <= now) {
    return buildDateInTz(n.year + 1, n.month, dayOfMonth, hours, minutes, tz);
  }

  return next;
}

/**
 * Next weekday (Mon-Fri) occurrence at the given time.
 * Skips Saturday and Sunday.
 */
function nextWeekday(
  now: Date,
  hours: number,
  minutes: number,
  tz?: string,
): Date {
  const n = nowInTz(now, tz);
  // Start from today
  for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
    const candidate = buildDateInTz(
      n.year,
      n.month,
      n.day + daysAhead,
      hours,
      minutes,
      tz,
    );
    if (candidate <= now) continue;
    // Check weekday in the target timezone, not UTC
    const candidateTz = nowInTz(candidate, tz);
    if (candidateTz.weekday >= 1 && candidateTz.weekday <= 5) {
      return candidate;
    }
  }
  // Fallback: next Monday
  const daysUntilMonday = (1 - n.weekday + 7) % 7 || 7;
  return buildDateInTz(
    n.year,
    n.month,
    n.day + daysUntilMonday,
    hours,
    minutes,
    tz,
  );
}

function calculateNextRunAtForInterval(config: {
  every: number;
  unit: string;
}): Date {
  const now = new Date();
  const ms = intervalToMs(config.every, config.unit);
  return new Date(now.getTime() + ms);
}

function intervalToMs(every: number, unit: string): number {
  switch (unit) {
    case 'minutes':
      return every * 60_000;
    case 'hours':
      return every * 3_600_000;
    case 'days':
      return every * 86_400_000;
    case 'weeks':
      return every * 604_800_000;
    case 'months':
      return every * 30 * 86_400_000;
    case 'years':
      return every * 365 * 86_400_000;
    default:
      return every * 86_400_000;
  }
}
