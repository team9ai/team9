import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { WS_EVENTS } from '@team9/shared';
import { WEBSOCKET_GATEWAY } from '../shared/constants/injection-tokens.js';
import type { WebsocketGateway } from '../im/websocket/websocket.gateway.js';
import type { CreateTriggerDto, UpdateTriggerDto } from './dto/trigger.dto.js';

@Injectable()
export class RoutineTriggersService {
  private readonly logger = new Logger(RoutineTriggersService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(WEBSOCKET_GATEWAY)
    private readonly wsGateway: WebsocketGateway,
  ) {}

  async create(routineId: string, dto: CreateTriggerDto, tenantId: string) {
    const trigger = await this.createInternal(routineId, dto, tenantId);

    await this.wsGateway.broadcastToWorkspace(
      tenantId,
      WS_EVENTS.ROUTINE.UPDATED,
      { routineId },
    );

    return trigger;
  }

  /**
   * Performs the actual trigger creation (validation + DB insert) WITHOUT
   * emitting a `routine:updated` broadcast. Used directly by createBatch()
   * so that creating a routine with N triggers via RoutinesService.create
   * does not produce N broadcasts for a single logical create operation.
   *
   * The public create() wraps this and emits once — that path handles the
   * single-trigger CRUD endpoint `POST /routines/:routineId/triggers`.
   */
  private async createInternal(
    routineId: string,
    dto: CreateTriggerDto,
    tenantId: string,
  ): Promise<schema.RoutineTrigger> {
    // Verify routine exists and belongs to tenant
    await this.getRoutineOrThrow(routineId, tenantId);

    // Validate config based on trigger type
    this.validateConfig(dto.type, dto.config);

    const triggerId = uuidv7();
    const now = new Date();

    // Calculate initial nextRunAt for interval/schedule triggers
    let nextRunAt: Date | null = null;
    if (dto.type === 'interval' || dto.type === 'schedule') {
      nextRunAt = this.calculateInitialNextRunAt(dto.type, dto.config);
    }

    const config = (dto.config ?? null) as schema.TriggerConfig | null;

    const [trigger] = await this.db
      .insert(schema.routineTriggers)
      .values({
        id: triggerId,
        routineId,
        type: dto.type,
        config,
        enabled: dto.enabled ?? true,
        nextRunAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return trigger;
  }

  async listByRoutine(routineId: string, tenantId: string) {
    await this.getRoutineOrThrow(routineId, tenantId);

    return this.db
      .select()
      .from(schema.routineTriggers)
      .where(eq(schema.routineTriggers.routineId, routineId));
  }

  async update(triggerId: string, dto: UpdateTriggerDto, tenantId: string) {
    const trigger = await this.getTriggerOrThrow(triggerId, tenantId);

    const updateData: Partial<schema.NewRoutineTrigger> = {
      updatedAt: new Date(),
    };

    if (dto.config !== undefined) {
      updateData.config = dto.config as schema.TriggerConfig;
    }
    if (dto.enabled !== undefined) {
      updateData.enabled = dto.enabled;
    }

    // Recalculate nextRunAt if config changed for interval/schedule triggers
    if (
      dto.config !== undefined &&
      (trigger.type === 'interval' || trigger.type === 'schedule')
    ) {
      updateData.nextRunAt = this.calculateInitialNextRunAt(
        trigger.type,
        dto.config,
      );
    }

    const [updated] = await this.db
      .update(schema.routineTriggers)
      .set(updateData)
      .where(eq(schema.routineTriggers.id, triggerId))
      .returning();

    await this.wsGateway.broadcastToWorkspace(
      tenantId,
      WS_EVENTS.ROUTINE.UPDATED,
      { routineId: trigger.routineId },
    );

    return updated;
  }

  async delete(triggerId: string, tenantId: string) {
    const trigger = await this.getTriggerOrThrow(triggerId, tenantId);

    await this.db
      .delete(schema.routineTriggers)
      .where(eq(schema.routineTriggers.id, triggerId));

    await this.wsGateway.broadcastToWorkspace(
      tenantId,
      WS_EVENTS.ROUTINE.UPDATED,
      { routineId: trigger.routineId },
    );

    return { success: true };
  }

  /**
   * Batch trigger creation — used by RoutinesService.create when a routine
   * is POSTed with N triggers. Deliberately bypasses the public create()
   * wrapper to avoid emitting N `routine:updated` broadcasts for one
   * logical creation operation. The outer CREATE flow does NOT emit
   * `routine:updated` either (it's a create, not an update).
   */
  async createBatch(
    routineId: string,
    dtos: CreateTriggerDto[],
    tenantId: string,
  ) {
    const results: schema.RoutineTrigger[] = [];
    for (const dto of dtos) {
      const trigger = await this.createInternal(routineId, dto, tenantId);
      results.push(trigger);
    }
    return results;
  }

  async replaceAllForRoutine(
    routineId: string,
    triggers: CreateTriggerDto[],
  ): Promise<void> {
    // No routine:updated emit here — outer callers (RoutinesService.update,
    // RoutineBotService.updateRoutine) emit once at the tail of their flow,
    // which already covers the triggers-replaced case. Emitting here would
    // produce duplicate broadcasts for the same user-visible change.
    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.routineTriggers)
        .where(eq(schema.routineTriggers.routineId, routineId));
      if (triggers.length > 0) {
        for (const trigger of triggers) {
          this.validateConfig(trigger.type, trigger.config);
          let nextRunAt: Date | null = null;
          if (trigger.type === 'interval' || trigger.type === 'schedule') {
            nextRunAt = this.calculateInitialNextRunAt(
              trigger.type,
              trigger.config,
            );
          }
          await tx.insert(schema.routineTriggers).values({
            id: uuidv7(),
            routineId,
            type: trigger.type,
            config: (trigger.config ?? {}) as schema.TriggerConfig,
            enabled: trigger.enabled ?? true,
            nextRunAt,
          });
        }
      }
    });
  }

  // ── Internal helpers ────────────────────────────────────────────

  private async getRoutineOrThrow(routineId: string, tenantId: string) {
    const [routine] = await this.db
      .select()
      .from(schema.routines)
      .where(
        and(
          eq(schema.routines.id, routineId),
          eq(schema.routines.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!routine) {
      throw new NotFoundException('Routine not found');
    }
    return routine;
  }

  private async getTriggerOrThrow(triggerId: string, tenantId: string) {
    const [trigger] = await this.db
      .select({
        trigger: schema.routineTriggers,
        tenantId: schema.routines.tenantId,
      })
      .from(schema.routineTriggers)
      .innerJoin(
        schema.routines,
        eq(schema.routineTriggers.routineId, schema.routines.id),
      )
      .where(
        and(
          eq(schema.routineTriggers.id, triggerId),
          eq(schema.routines.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!trigger) {
      throw new NotFoundException('Trigger not found');
    }
    return trigger.trigger;
  }

  private validateConfig(type: string, config?: Record<string, unknown>): void {
    if (type === 'manual') return; // No config needed

    if (!config) {
      throw new BadRequestException(`Config is required for ${type} triggers`);
    }

    if (type === 'interval') {
      if (typeof config.every !== 'number' || config.every < 1) {
        throw new BadRequestException(
          'Interval trigger config requires "every" (positive integer)',
        );
      }
      const validUnits = [
        'minutes',
        'hours',
        'days',
        'weeks',
        'months',
        'years',
      ];
      if (!validUnits.includes(config.unit as string)) {
        throw new BadRequestException(
          `Interval trigger config requires "unit" (${validUnits.join(', ')})`,
        );
      }
    }

    if (type === 'schedule') {
      const validFreqs = ['daily', 'weekly', 'monthly', 'yearly', 'weekdays'];
      if (!validFreqs.includes(config.frequency as string)) {
        throw new BadRequestException(
          `Schedule trigger config requires "frequency" (${validFreqs.join(', ')})`,
        );
      }
      if (
        typeof config.time !== 'string' ||
        !/^\d{2}:\d{2}$/.test(config.time)
      ) {
        throw new BadRequestException(
          'Schedule trigger config requires "time" in HH:mm format',
        );
      }
      if (typeof config.timezone !== 'string' || !config.timezone) {
        throw new BadRequestException(
          'Schedule trigger config requires "timezone"',
        );
      }
    }

    if (type === 'channel_message') {
      if (typeof config.channelId !== 'string' || !config.channelId) {
        throw new BadRequestException(
          'Channel message trigger config requires "channelId"',
        );
      }
    }
  }

  private calculateInitialNextRunAt(
    type: string,
    config?: Record<string, unknown>,
  ): Date | null {
    if (!config) return null;
    const now = new Date();

    if (type === 'interval') {
      const every = config.every as number;
      const unit = config.unit as string;
      if (!every || !unit) return null;
      const ms = this.intervalToMs(every, unit);
      return new Date(now.getTime() + ms);
    }

    // For schedule type, calculate the first run using the trigger timezone.
    // The task-worker scheduler uses the same semantics when advancing it.
    if (type === 'schedule') {
      return calculateNextRunAt(config as schema.ScheduleConfig);
    }

    return null;
  }

  private intervalToMs(every: number, unit: string): number {
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
}

function calculateNextRunAt(config?: schema.ScheduleConfig): Date | null {
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

function parseTime(time?: string): [number, number] {
  if (!time) return [0, 0];
  const parts = time.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return [Number.isNaN(h) ? 0 : h, Number.isNaN(m) ? 0 : m];
}

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
    return Math.round((tzTime - date.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

function buildDateInTz(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  tz?: string,
): Date {
  if (!tz) {
    return new Date(year, month, day, hours, minutes, 0, 0);
  }
  const utcGuess = new Date(Date.UTC(year, month, day, hours, minutes, 0, 0));
  const offset = getTimezoneOffsetMinutes(utcGuess, tz);
  return new Date(utcGuess.getTime() - offset * 60_000);
}

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

function nextDaily(
  now: Date,
  hours: number,
  minutes: number,
  tz?: string,
): Date {
  const n = nowInTz(now, tz);
  const next = buildDateInTz(n.year, n.month, n.day, hours, minutes, tz);
  if (next <= now) {
    return buildDateInTz(n.year, n.month, n.day + 1, hours, minutes, tz);
  }
  return next;
}

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

function nextMonthly(
  now: Date,
  hours: number,
  minutes: number,
  dayOfMonth: number,
  tz?: string,
): Date {
  const n = nowInTz(now, tz);
  const lastDayThisMonth = new Date(n.year, n.month + 1, 0).getDate();
  const clampedDay = Math.min(dayOfMonth, lastDayThisMonth);
  const next = buildDateInTz(n.year, n.month, clampedDay, hours, minutes, tz);

  if (next <= now) {
    const nextMonth = n.month + 1;
    const lastDayNextMonth = new Date(n.year, nextMonth + 1, 0).getDate();
    const clampedNextDay = Math.min(dayOfMonth, lastDayNextMonth);
    return buildDateInTz(n.year, nextMonth, clampedNextDay, hours, minutes, tz);
  }
  return next;
}

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

function nextWeekday(
  now: Date,
  hours: number,
  minutes: number,
  tz?: string,
): Date {
  const n = nowInTz(now, tz);
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
    const candidateTz = nowInTz(candidate, tz);
    if (candidateTz.weekday >= 1 && candidateTz.weekday <= 5) {
      return candidate;
    }
  }
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
