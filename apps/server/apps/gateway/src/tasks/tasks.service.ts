import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  desc,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type {
  ScheduleConfig,
  AgentTaskStatus,
  AgentTaskScheduleType,
} from '@team9/database/schemas';
import { DocumentsService } from '../documents/documents.service.js';
import type { CreateTaskDto } from './dto/create-task.dto.js';
import type { UpdateTaskDto } from './dto/update-task.dto.js';

// ── Filter types ────────────────────────────────────────────────────

export interface TaskListFilters {
  botId?: string;
  status?: AgentTaskStatus;
  scheduleType?: AgentTaskScheduleType;
}

// ── Service ─────────────────────────────────────────────────────────

@Injectable()
export class TasksService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly documentsService: DocumentsService,
  ) {}

  // ── CRUD ────────────────────────────────────────────────────────

  async create(dto: CreateTaskDto, userId: string, tenantId: string) {
    const taskId = uuidv7();

    // Optionally create a linked document
    let documentId: string | undefined;
    if (dto.documentContent !== undefined) {
      const doc = await this.documentsService.create(
        {
          documentType: 'task',
          content: dto.documentContent,
          title: dto.title,
        },
        { type: 'user', id: userId },
        tenantId,
      );
      documentId = doc.id;
    }

    const [task] = await this.db
      .insert(schema.agentTasks)
      .values({
        id: taskId,
        tenantId,
        botId: dto.botId,
        creatorId: userId,
        title: dto.title,
        description: dto.description ?? null,
        scheduleType: dto.scheduleType ?? 'once',
        scheduleConfig: (dto.scheduleConfig as ScheduleConfig) ?? null,
        documentId: documentId ?? null,
      })
      .returning();

    return task;
  }

  async list(tenantId: string, filters?: TaskListFilters) {
    const conditions = [eq(schema.agentTasks.tenantId, tenantId)];

    if (filters?.botId) {
      conditions.push(eq(schema.agentTasks.botId, filters.botId));
    }
    if (filters?.status) {
      conditions.push(eq(schema.agentTasks.status, filters.status));
    }
    if (filters?.scheduleType) {
      conditions.push(eq(schema.agentTasks.scheduleType, filters.scheduleType));
    }

    const tasks = await this.db
      .select()
      .from(schema.agentTasks)
      .where(and(...conditions))
      .orderBy(desc(schema.agentTasks.createdAt));

    return tasks;
  }

  async getById(taskId: string) {
    const [task] = await this.db
      .select()
      .from(schema.agentTasks)
      .where(eq(schema.agentTasks.id, taskId))
      .limit(1);

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    // Fetch current execution with steps, interventions, deliverables
    let currentExecution: {
      execution: schema.AgentTaskExecution;
      steps: schema.AgentTaskStep[];
      interventions: schema.AgentTaskIntervention[];
      deliverables: schema.AgentTaskDeliverable[];
    } | null = null;

    if (task.currentExecutionId) {
      const [execution] = await this.db
        .select()
        .from(schema.agentTaskExecutions)
        .where(eq(schema.agentTaskExecutions.id, task.currentExecutionId))
        .limit(1);

      if (execution) {
        const steps = await this.db
          .select()
          .from(schema.agentTaskSteps)
          .where(eq(schema.agentTaskSteps.executionId, execution.id))
          .orderBy(schema.agentTaskSteps.orderIndex);

        const interventions = await this.db
          .select()
          .from(schema.agentTaskInterventions)
          .where(eq(schema.agentTaskInterventions.executionId, execution.id));

        const deliverables = await this.db
          .select()
          .from(schema.agentTaskDeliverables)
          .where(eq(schema.agentTaskDeliverables.executionId, execution.id));

        currentExecution = { execution, steps, interventions, deliverables };
      }
    }

    return { ...task, currentExecution };
  }

  async update(taskId: string, dto: UpdateTaskDto, userId: string) {
    const task = await this.getTaskOrThrow(taskId);
    this.assertCreatorOwnership(task, userId);

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.scheduleType !== undefined)
      updateData.scheduleType = dto.scheduleType;
    if (dto.scheduleConfig !== undefined)
      updateData.scheduleConfig = dto.scheduleConfig;

    const [updated] = await this.db
      .update(schema.agentTasks)
      .set(updateData)
      .where(eq(schema.agentTasks.id, taskId))
      .returning();

    return updated;
  }

  async delete(taskId: string, userId: string) {
    const task = await this.getTaskOrThrow(taskId);
    this.assertCreatorOwnership(task, userId);

    await this.db
      .delete(schema.agentTasks)
      .where(eq(schema.agentTasks.id, taskId));

    return { success: true };
  }

  // ── Executions ──────────────────────────────────────────────────

  async getExecutions(taskId: string) {
    await this.getTaskOrThrow(taskId);

    const executions = await this.db
      .select()
      .from(schema.agentTaskExecutions)
      .where(eq(schema.agentTaskExecutions.taskId, taskId))
      .orderBy(desc(schema.agentTaskExecutions.version));

    return executions;
  }

  async getExecution(taskId: string, executionId: string) {
    await this.getTaskOrThrow(taskId);

    const [execution] = await this.db
      .select()
      .from(schema.agentTaskExecutions)
      .where(
        and(
          eq(schema.agentTaskExecutions.id, executionId),
          eq(schema.agentTaskExecutions.taskId, taskId),
        ),
      )
      .limit(1);

    if (!execution) {
      throw new NotFoundException('Execution not found');
    }

    const steps = await this.db
      .select()
      .from(schema.agentTaskSteps)
      .where(eq(schema.agentTaskSteps.executionId, executionId))
      .orderBy(schema.agentTaskSteps.orderIndex);

    const deliverables = await this.db
      .select()
      .from(schema.agentTaskDeliverables)
      .where(eq(schema.agentTaskDeliverables.executionId, executionId));

    const interventions = await this.db
      .select()
      .from(schema.agentTaskInterventions)
      .where(eq(schema.agentTaskInterventions.executionId, executionId));

    return { ...execution, steps, deliverables, interventions };
  }

  // ── Deliverables ────────────────────────────────────────────────

  async getDeliverables(taskId: string, executionId?: string) {
    await this.getTaskOrThrow(taskId);

    const conditions = [eq(schema.agentTaskDeliverables.taskId, taskId)];
    if (executionId) {
      conditions.push(
        eq(schema.agentTaskDeliverables.executionId, executionId),
      );
    }

    const deliverables = await this.db
      .select()
      .from(schema.agentTaskDeliverables)
      .where(and(...conditions))
      .orderBy(desc(schema.agentTaskDeliverables.createdAt));

    return deliverables;
  }

  // ── Interventions ───────────────────────────────────────────────

  async getInterventions(taskId: string) {
    await this.getTaskOrThrow(taskId);

    const interventions = await this.db
      .select()
      .from(schema.agentTaskInterventions)
      .where(
        and(
          eq(schema.agentTaskInterventions.taskId, taskId),
          eq(schema.agentTaskInterventions.status, 'pending'),
        ),
      )
      .orderBy(desc(schema.agentTaskInterventions.createdAt));

    return interventions;
  }

  // ── Internal helpers ────────────────────────────────────────────

  private async getTaskOrThrow(id: string): Promise<schema.AgentTask> {
    const [task] = await this.db
      .select()
      .from(schema.agentTasks)
      .where(eq(schema.agentTasks.id, id))
      .limit(1);

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return task;
  }

  private assertCreatorOwnership(task: schema.AgentTask, userId: string): void {
    if (task.creatorId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to perform this action',
      );
    }
  }
}
