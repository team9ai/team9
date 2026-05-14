import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  and,
  desc,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { CreateTaskRunDto } from './dto/create-task-run.dto.js';

@Injectable()
export class TasksService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async create(dto: CreateTaskRunDto, userId: string, tenantId: string) {
    const runId = uuidv7();
    const channelId = uuidv7();

    await this.db.insert(schema.channels).values({
      id: channelId,
      tenantId,
      name: `task-${dto.title.slice(0, 60).replace(/\s+/g, '-').toLowerCase()}-${channelId.slice(-6)}`,
      type: 'task',
      createdBy: userId,
    });

    await this.db.insert(schema.channelMembers).values({
      id: uuidv7(),
      channelId,
      userId,
      role: 'owner',
    });

    if (dto.botId) {
      const [bot] = await this.db
        .select({ userId: schema.bots.userId })
        .from(schema.bots)
        .where(eq(schema.bots.id, dto.botId))
        .limit(1);

      if (bot) {
        await this.db.insert(schema.channelMembers).values({
          id: uuidv7(),
          channelId,
          userId: bot.userId,
          role: 'member',
        });
      }
    }

    const [run] = await this.db
      .insert(schema.taskRuns)
      .values({
        id: runId,
        tenantId,
        routineId: null,
        routineVersion: null,
        botId: dto.botId ?? null,
        creatorId: userId,
        title: dto.title,
        description: dto.description ?? null,
        status: 'upcoming',
        channelId,
      })
      .returning();

    return run;
  }

  async list(tenantId: string) {
    return this.db
      .select()
      .from(schema.taskRuns)
      .where(eq(schema.taskRuns.tenantId, tenantId))
      .orderBy(desc(schema.taskRuns.createdAt));
  }

  async getById(runId: string, tenantId: string) {
    const [run] = await this.db
      .select()
      .from(schema.taskRuns)
      .where(
        and(
          eq(schema.taskRuns.id, runId),
          eq(schema.taskRuns.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!run) {
      throw new NotFoundException('Task run not found');
    }

    const deliverables = await this.db
      .select()
      .from(schema.taskDeliverables)
      .where(eq(schema.taskDeliverables.runId, run.id))
      .orderBy(desc(schema.taskDeliverables.createdAt));

    return { ...run, deliverables };
  }

  async getDeliverables(runId: string, tenantId: string) {
    await this.getRunOrThrow(runId, tenantId);

    return this.db
      .select()
      .from(schema.taskDeliverables)
      .where(eq(schema.taskDeliverables.runId, runId))
      .orderBy(desc(schema.taskDeliverables.createdAt));
  }

  private async getRunOrThrow(runId: string, tenantId: string) {
    const [run] = await this.db
      .select({ id: schema.taskRuns.id })
      .from(schema.taskRuns)
      .where(
        and(
          eq(schema.taskRuns.id, runId),
          eq(schema.taskRuns.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!run) {
      throw new NotFoundException('Task run not found');
    }

    return run;
  }
}
