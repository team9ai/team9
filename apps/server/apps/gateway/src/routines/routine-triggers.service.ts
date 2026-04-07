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
import type { CreateTriggerDto, UpdateTriggerDto } from './dto/trigger.dto.js';

@Injectable()
export class RoutineTriggersService {
  private readonly logger = new Logger(RoutineTriggersService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async create(routineId: string, dto: CreateTriggerDto, tenantId: string) {
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

    return updated;
  }

  async delete(triggerId: string, tenantId: string) {
    await this.getTriggerOrThrow(triggerId, tenantId);

    await this.db
      .delete(schema.routineTriggers)
      .where(eq(schema.routineTriggers.id, triggerId));

    return { success: true };
  }

  async createBatch(
    routineId: string,
    dtos: CreateTriggerDto[],
    tenantId: string,
  ) {
    const results: schema.RoutineTrigger[] = [];
    for (const dto of dtos) {
      const trigger = await this.create(routineId, dto, tenantId);
      results.push(trigger);
    }
    return results;
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

    // For schedule type, use a simple initial calculation — will be refined by task-worker scheduler
    if (type === 'schedule') {
      const time = config.time as string;
      if (!time) return null;
      const [hours, minutes] = time.split(':').map(Number);
      const next = new Date(now);
      next.setHours(hours, minutes, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      return next;
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
