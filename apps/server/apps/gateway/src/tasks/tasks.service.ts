import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  desc,
  sql,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type {
  ScheduleConfig,
  AgentTaskStatus,
  AgentTaskScheduleType,
} from '@team9/database/schemas';
import {
  AmqpConnection,
  RABBITMQ_EXCHANGES,
  RABBITMQ_ROUTING_KEYS,
} from '@team9/rabbitmq';
import { DocumentsService } from '../documents/documents.service.js';
import { TriggersService } from './triggers.service.js';
import type { CreateTaskDto } from './dto/create-task.dto.js';
import type { UpdateTaskDto } from './dto/update-task.dto.js';
import type { StartTaskDto } from './dto/task-control.dto.js';
import type { StartTaskNewDto } from './dto/trigger.dto.js';
import type { ResumeTaskDto } from './dto/task-control.dto.js';
import type { StopTaskDto } from './dto/task-control.dto.js';
import type { ResolveInterventionDto } from './dto/resolve-intervention.dto.js';
import type { RetryExecutionDto } from './dto/trigger.dto.js';
import { TaskCastService } from './taskcast.service.js';

// ── Filter types ────────────────────────────────────────────────────

export interface TaskListFilters {
  botId?: string;
  status?: AgentTaskStatus;
  scheduleType?: AgentTaskScheduleType;
}

// ── Service ─────────────────────────────────────────────────────────

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly documentsService: DocumentsService,
    private readonly amqpConnection: AmqpConnection,
    private readonly triggersService: TriggersService,
    private readonly taskCastService: TaskCastService,
  ) {}

  // ── CRUD ────────────────────────────────────────────────────────

  async create(dto: CreateTaskDto, userId: string, tenantId: string) {
    const taskId = uuidv7();

    // Always create a linked document for the task
    const doc = await this.documentsService.create(
      {
        documentType: 'task',
        content: dto.documentContent ?? '',
        title: dto.title,
      },
      { type: 'user', id: userId },
      tenantId,
    );
    const documentId = doc.id;

    const [task] = await this.db
      .insert(schema.agentTasks)
      .values({
        id: taskId,
        tenantId,
        botId: dto.botId ?? null,
        creatorId: userId,
        title: dto.title,
        description: dto.description ?? null,
        scheduleType: dto.scheduleType ?? 'once',
        scheduleConfig: (dto.scheduleConfig as ScheduleConfig) ?? null,
        documentId,
      })
      .returning();

    if (dto.triggers?.length) {
      await this.triggersService.createBatch(taskId, dto.triggers, tenantId);
    }

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

    const rows = await this.db
      .select({
        task: schema.agentTasks,
        executionTokenUsage: schema.agentTaskExecutions.tokenUsage,
      })
      .from(schema.agentTasks)
      .leftJoin(
        schema.agentTaskExecutions,
        eq(schema.agentTasks.currentExecutionId, schema.agentTaskExecutions.id),
      )
      .where(and(...conditions))
      .orderBy(desc(schema.agentTasks.createdAt));

    return rows.map((row) => ({
      ...row.task,
      tokenUsage: row.executionTokenUsage ?? 0,
    }));
  }

  async getById(taskId: string, tenantId: string) {
    const task = await this.getTaskOrThrow(taskId, tenantId);

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

  async update(
    taskId: string,
    dto: UpdateTaskDto,
    userId: string,
    tenantId: string,
  ) {
    const task = await this.getTaskOrThrow(taskId, tenantId);
    this.assertCreatorOwnership(task, userId);

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.botId !== undefined) updateData.botId = dto.botId;
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

  async delete(taskId: string, userId: string, tenantId: string) {
    const task = await this.getTaskOrThrow(taskId, tenantId);
    this.assertCreatorOwnership(task, userId);

    // Prevent deletion of active tasks — must stop first
    const activeStatuses: string[] = [
      'in_progress',
      'paused',
      'pending_action',
    ];
    if (activeStatuses.includes(task.status)) {
      throw new BadRequestException(
        `Cannot delete task in ${task.status} status. Stop the task first.`,
      );
    }

    await this.db
      .delete(schema.agentTasks)
      .where(eq(schema.agentTasks.id, taskId));

    return { success: true };
  }

  // ── Executions ──────────────────────────────────────────────────

  async getExecutions(taskId: string, tenantId: string) {
    await this.getTaskOrThrow(taskId, tenantId);

    const executions = await this.db
      .select()
      .from(schema.agentTaskExecutions)
      .where(eq(schema.agentTaskExecutions.taskId, taskId))
      .orderBy(desc(schema.agentTaskExecutions.version));

    return executions;
  }

  async getExecution(taskId: string, executionId: string, tenantId: string) {
    await this.getTaskOrThrow(taskId, tenantId);

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

  async getExecutionEntries(
    taskId: string,
    executionId: string,
    tenantId: string,
  ) {
    await this.getTaskOrThrow(taskId, tenantId);

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

    const [steps, interventions, deliverables] = await Promise.all([
      this.db
        .select()
        .from(schema.agentTaskSteps)
        .where(eq(schema.agentTaskSteps.executionId, executionId)),
      this.db
        .select()
        .from(schema.agentTaskInterventions)
        .where(eq(schema.agentTaskInterventions.executionId, executionId)),
      this.db
        .select()
        .from(schema.agentTaskDeliverables)
        .where(eq(schema.agentTaskDeliverables.executionId, executionId)),
    ]);

    // Merge into a unified timeline sorted by createdAt
    type Entry =
      | { type: 'step'; data: (typeof steps)[0]; at: Date }
      | { type: 'intervention'; data: (typeof interventions)[0]; at: Date }
      | { type: 'deliverable'; data: (typeof deliverables)[0]; at: Date }
      | {
          type: 'status_change';
          data: { status: string; at: string };
          at: Date;
        };

    const entries: Entry[] = [
      ...steps.map((s) => ({
        type: 'step' as const,
        data: s,
        at: s.createdAt ?? new Date(0),
      })),
      ...interventions.map((i) => ({
        type: 'intervention' as const,
        data: i,
        at: i.createdAt ?? new Date(0),
      })),
      ...deliverables.map((d) => ({
        type: 'deliverable' as const,
        data: d,
        at: d.createdAt ?? new Date(0),
      })),
    ];

    // Synthesize status_change entries from execution timestamps
    if (execution.startedAt) {
      entries.push({
        type: 'status_change',
        data: { status: 'started', at: execution.startedAt.toISOString() },
        at: execution.startedAt,
      });
    }
    if (execution.completedAt) {
      entries.push({
        type: 'status_change',
        data: {
          status: execution.status,
          at: execution.completedAt.toISOString(),
        },
        at: execution.completedAt,
      });
    }

    entries.sort((a, b) => a.at.getTime() - b.at.getTime());

    return entries.map(({ type, data }) => ({ type, data }));
  }

  // ── Deliverables ────────────────────────────────────────────────

  async getDeliverables(
    taskId: string,
    executionId?: string,
    tenantId?: string,
  ) {
    await this.getTaskOrThrow(taskId, tenantId);

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

  async getInterventions(taskId: string, tenantId: string) {
    await this.getTaskOrThrow(taskId, tenantId);

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

  // ── Task Control ──────────────────────────────────────────────

  async start(
    taskId: string,
    userId: string,
    tenantId: string,
    dto: StartTaskDto | StartTaskNewDto,
  ) {
    const task = await this.getTaskOrThrow(taskId, tenantId);
    if (!task.botId) {
      throw new BadRequestException(
        'Cannot start task without an assigned bot',
      );
    }
    this.validateStatusTransition(task.status, 'start');

    await this.publishTaskCommand({
      type: 'start',
      taskId,
      userId,
      message: dto.message,
      notes: 'notes' in dto ? dto.notes : undefined,
      triggerId: 'triggerId' in dto ? dto.triggerId : undefined,
    });

    return { success: true };
  }

  async pause(taskId: string, userId: string, tenantId: string) {
    const task = await this.getTaskOrThrow(taskId, tenantId);
    this.validateStatusTransition(task.status, 'pause');

    await this.publishTaskCommand({
      type: 'pause',
      taskId,
      userId,
    });

    // Sync paused status to TaskCast (deterministic ID — no DB lookup)
    if (task.currentExecutionId) {
      const tcId = TaskCastService.taskcastId(task.currentExecutionId);
      await this.taskCastService.transitionStatus(tcId, 'paused');
    }

    return { success: true };
  }

  async resume(
    taskId: string,
    userId: string,
    tenantId: string,
    dto: ResumeTaskDto,
  ) {
    const task = await this.getTaskOrThrow(taskId, tenantId);
    this.validateStatusTransition(task.status, 'resume');

    await this.publishTaskCommand({
      type: 'resume',
      taskId,
      userId,
      message: dto.message,
    });

    // Sync running status to TaskCast (deterministic ID — no DB lookup)
    if (task.currentExecutionId) {
      const tcId = TaskCastService.taskcastId(task.currentExecutionId);
      await this.taskCastService.transitionStatus(tcId, 'in_progress');
    }

    return { success: true };
  }

  async stop(
    taskId: string,
    userId: string,
    tenantId: string,
    dto: StopTaskDto,
  ) {
    const task = await this.getTaskOrThrow(taskId, tenantId);
    this.validateStatusTransition(task.status, 'stop');

    await this.publishTaskCommand({
      type: 'stop',
      taskId,
      userId,
      message: dto.reason,
    });

    // Sync cancelled status to TaskCast (deterministic ID — no DB lookup)
    if (task.currentExecutionId) {
      const tcId = TaskCastService.taskcastId(task.currentExecutionId);
      await this.taskCastService.transitionStatus(tcId, 'stopped');
    }

    return { success: true };
  }

  async restart(taskId: string, userId: string, tenantId: string) {
    const task = await this.getTaskOrThrow(taskId, tenantId);
    this.validateStatusTransition(task.status, 'restart');

    await this.publishTaskCommand({
      type: 'restart',
      taskId,
      userId,
    });

    return { success: true };
  }

  // ── Retry ───────────────────────────────────────────────────

  async retry(
    taskId: string,
    dto: RetryExecutionDto,
    userId: string,
    tenantId: string,
  ) {
    const task = await this.getTaskOrThrow(taskId, tenantId);

    // Find the source execution
    const [sourceExec] = await this.db
      .select()
      .from(schema.agentTaskExecutions)
      .where(
        and(
          eq(schema.agentTaskExecutions.id, dto.executionId),
          eq(schema.agentTaskExecutions.taskId, taskId),
        ),
      )
      .limit(1);

    if (!sourceExec) {
      throw new NotFoundException('Execution not found');
    }

    // Source execution must be in a terminal state
    const terminalStatuses = ['completed', 'failed', 'timeout', 'stopped'];
    if (!terminalStatuses.includes(sourceExec.status)) {
      throw new BadRequestException(
        `Cannot retry execution in ${sourceExec.status} status`,
      );
    }

    if (!task.botId) {
      throw new BadRequestException(
        'Cannot retry task without an assigned bot',
      );
    }

    await this.publishTaskCommand({
      type: 'retry',
      taskId,
      userId,
      notes: dto.notes,
      sourceExecutionId: dto.executionId,
    });

    return { success: true };
  }

  // ── Intervention Resolution ──────────────────────────────────

  async resolveIntervention(
    taskId: string,
    interventionId: string,
    userId: string,
    tenantId: string,
    dto: ResolveInterventionDto,
  ) {
    const task = await this.getTaskOrThrow(taskId, tenantId);

    const [intervention] = await this.db
      .select()
      .from(schema.agentTaskInterventions)
      .where(
        and(
          eq(schema.agentTaskInterventions.id, interventionId),
          eq(schema.agentTaskInterventions.taskId, taskId),
        ),
      )
      .limit(1);

    if (!intervention) {
      throw new NotFoundException('Intervention not found');
    }

    if (intervention.status !== 'pending') {
      throw new BadRequestException(
        `Intervention is already ${intervention.status}`,
      );
    }

    // Verify intervention belongs to the current execution
    if (task.currentExecutionId !== intervention.executionId) {
      throw new BadRequestException(
        'Intervention belongs to a previous execution. Cannot resolve.',
      );
    }

    // Update the intervention
    const [updated] = await this.db
      .update(schema.agentTaskInterventions)
      .set({
        status: 'resolved',
        resolvedBy: userId,
        resolvedAt: new Date(),
        response: { action: dto.action, message: dto.message },
      })
      .where(eq(schema.agentTaskInterventions.id, interventionId))
      .returning();

    // Update task status back to in_progress
    await this.db
      .update(schema.agentTasks)
      .set({ status: 'in_progress', updatedAt: new Date() })
      .where(eq(schema.agentTasks.id, taskId));

    // Update execution status back to in_progress (only if still pending_action)
    await this.db
      .update(schema.agentTaskExecutions)
      .set({ status: 'in_progress' })
      .where(
        and(
          eq(schema.agentTaskExecutions.id, intervention.executionId),
          eq(schema.agentTaskExecutions.status, 'pending_action'),
        ),
      );

    // Sync running status to TaskCast (unblock) — deterministic ID, no DB lookup
    const tcId = TaskCastService.taskcastId(intervention.executionId);
    await this.taskCastService.transitionStatus(tcId, 'in_progress');
    await this.taskCastService.publishEvent(tcId, {
      type: 'intervention',
      data: {
        intervention: {
          ...updated,
          status: 'resolved',
        },
      },
      seriesId: `intervention:${interventionId}`,
      seriesMode: 'latest',
    });

    // Publish resume command via RabbitMQ
    await this.publishTaskCommand({
      type: 'resume',
      taskId,
      userId,
      message: `Intervention resolved: ${dto.action}${dto.message ? ` - ${dto.message}` : ''}`,
    });

    return updated;
  }

  // ── Internal helpers ────────────────────────────────────────────

  private async getTaskOrThrow(
    id: string,
    tenantId?: string,
  ): Promise<schema.AgentTask> {
    const conditions = [eq(schema.agentTasks.id, id)];
    if (tenantId) {
      conditions.push(eq(schema.agentTasks.tenantId, tenantId));
    }

    const [task] = await this.db
      .select()
      .from(schema.agentTasks)
      .where(and(...conditions))
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

  private validateStatusTransition(currentStatus: string, action: string) {
    const allowed: Record<string, string[]> = {
      start: ['upcoming'],
      pause: ['in_progress'],
      resume: ['paused'],
      stop: ['in_progress', 'paused', 'pending_action'],
      restart: ['completed', 'failed', 'timeout', 'stopped'],
    };
    if (!allowed[action]?.includes(currentStatus)) {
      throw new BadRequestException(
        `Cannot ${action} task in ${currentStatus} status`,
      );
    }
  }

  private async publishTaskCommand(command: {
    type: string;
    taskId: string;
    userId: string;
    message?: string;
    notes?: string;
    triggerId?: string;
    sourceExecutionId?: string;
  }): Promise<void> {
    try {
      await this.amqpConnection.publish(
        RABBITMQ_EXCHANGES.TASK_COMMANDS,
        RABBITMQ_ROUTING_KEYS.TASK_COMMAND,
        command,
        { persistent: true },
      );
      this.logger.debug(
        `Published task command: ${command.type} for task ${command.taskId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to publish task command: ${error}`);
      throw error;
    }
  }
}
