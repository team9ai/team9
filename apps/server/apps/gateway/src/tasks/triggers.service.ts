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
export class TriggersService {
  private readonly logger = new Logger(TriggersService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async create(taskId: string, dto: CreateTriggerDto, tenantId: string) {
    // Verify task exists and belongs to tenant
    await this.getTaskOrThrow(taskId, tenantId);

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
      .insert(schema.agentTaskTriggers)
      .values({
        id: triggerId,
        taskId,
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

  async listByTask(taskId: string, tenantId: string) {
    await this.getTaskOrThrow(taskId, tenantId);

    return this.db
      .select()
      .from(schema.agentTaskTriggers)
      .where(eq(schema.agentTaskTriggers.taskId, taskId));
  }

  async update(triggerId: string, dto: UpdateTriggerDto, tenantId: string) {
    const trigger = await this.getTriggerOrThrow(triggerId, tenantId);

    const updateData: Partial<schema.NewAgentTaskTrigger> = {
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
      .update(schema.agentTaskTriggers)
      .set(updateData)
      .where(eq(schema.agentTaskTriggers.id, triggerId))
      .returning();

    return updated;
  }

  async delete(triggerId: string, tenantId: string) {
    await this.getTriggerOrThrow(triggerId, tenantId);

    await this.db
      .delete(schema.agentTaskTriggers)
      .where(eq(schema.agentTaskTriggers.id, triggerId));

    return { success: true };
  }

  async createBatch(
    taskId: string,
    dtos: CreateTriggerDto[],
    tenantId: string,
  ) {
    const results: schema.AgentTaskTrigger[] = [];
    for (const dto of dtos) {
      const trigger = await this.create(taskId, dto, tenantId);
      results.push(trigger);
    }
    return results;
  }

  // ── Internal helpers ────────────────────────────────────────────

  private async getTaskOrThrow(taskId: string, tenantId: string) {
    const [task] = await this.db
      .select()
      .from(schema.agentTasks)
      .where(
        and(
          eq(schema.agentTasks.id, taskId),
          eq(schema.agentTasks.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  private async getTriggerOrThrow(triggerId: string, tenantId: string) {
    const [trigger] = await this.db
      .select({
        trigger: schema.agentTaskTriggers,
        tenantId: schema.agentTasks.tenantId,
      })
      .from(schema.agentTaskTriggers)
      .innerJoin(
        schema.agentTasks,
        eq(schema.agentTaskTriggers.taskId, schema.agentTasks.id),
      )
      .where(
        and(
          eq(schema.agentTaskTriggers.id, triggerId),
          eq(schema.agentTasks.tenantId, tenantId),
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
