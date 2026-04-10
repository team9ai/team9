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
  ne,
  or,
  and,
  desc,
  sql,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type {
  ScheduleConfig,
  RoutineStatus,
  RoutineScheduleType,
} from '@team9/database/schemas';
import {
  AmqpConnection,
  RABBITMQ_EXCHANGES,
  RABBITMQ_ROUTING_KEYS,
} from '@team9/rabbitmq';
import { DocumentsService } from '../documents/documents.service.js';
import { ChannelsService } from '../im/channels/channels.service.js';
import { ClawHiveService } from '@team9/claw-hive';
import { BotService } from '../bot/bot.service.js';
import { RoutineTriggersService } from './routine-triggers.service.js';
import type { CreateRoutineDto } from './dto/create-routine.dto.js';
import type { UpdateRoutineDto } from './dto/update-routine.dto.js';
import type { StartRoutineDto } from './dto/routine-control.dto.js';
import type { StartRoutineNewDto } from './dto/trigger.dto.js';
import type { ResumeRoutineDto } from './dto/routine-control.dto.js';
import type { StopRoutineDto } from './dto/routine-control.dto.js';
import type { ResolveInterventionDto } from './dto/resolve-intervention.dto.js';
import type { RetryExecutionDto } from './dto/trigger.dto.js';
import type { CompleteCreationDto } from './dto/complete-creation.dto.js';
import type { CreateWithCreationTaskDto } from './dto/with-creation-task.dto.js';
import { TaskCastService } from './taskcast.service.js';

// ── Filter types ────────────────────────────────────────────────────

export interface RoutineListFilters {
  botId?: string;
  status?: RoutineStatus;
  scheduleType?: RoutineScheduleType;
}

// ── Service ─────────────────────────────────────────────────────────

@Injectable()
export class RoutinesService {
  private readonly logger = new Logger(RoutinesService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly documentsService: DocumentsService,
    private readonly amqpConnection: AmqpConnection,
    private readonly routineTriggersService: RoutineTriggersService,
    private readonly taskCastService: TaskCastService,
    private readonly channelsService: ChannelsService,
    private readonly clawHiveService: ClawHiveService,
    private readonly botsService: BotService,
  ) {}

  // ── CRUD ────────────────────────────────────────────────────────

  async create(
    dto: CreateRoutineDto,
    userId: string,
    tenantId: string,
    options?: { sourceRef?: string },
  ) {
    const routineId = uuidv7();
    const status = dto.status ?? 'upcoming';

    // Always create a linked document for the routine
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

    const insertValues: schema.NewRoutine = {
      id: routineId,
      tenantId,
      botId: dto.botId ?? null,
      creatorId: userId,
      title: dto.title,
      description: dto.description ?? null,
      scheduleType: dto.scheduleType ?? 'once',
      scheduleConfig: (dto.scheduleConfig as ScheduleConfig) ?? null,
      documentId,
    };
    // status and sourceRef are new schema columns added in Task 0 — cast to bypass
    // stale type resolution in pnpm workspaces / worktrees environment
    (insertValues as Record<string, unknown>).status = status;
    (insertValues as Record<string, unknown>).sourceRef =
      options?.sourceRef ?? null;

    const [routine] = await this.db
      .insert(schema.routines)
      .values(insertValues)
      .returning();

    // Skip trigger registration for drafts
    if ((status as string) !== 'draft' && dto.triggers?.length) {
      await this.routineTriggersService.createBatch(
        routineId,
        dto.triggers,
        tenantId,
      );
    }

    return routine;
  }

  async list(
    tenantId: string,
    filters?: RoutineListFilters,
    currentUserId?: string,
  ) {
    const conditions = [eq(schema.routines.tenantId, tenantId)];

    if (filters?.botId) {
      conditions.push(eq(schema.routines.botId, filters.botId));
    }
    if (filters?.status) {
      conditions.push(eq(schema.routines.status, filters.status));
    }
    if (filters?.scheduleType) {
      conditions.push(eq(schema.routines.scheduleType, filters.scheduleType));
    }

    // Hide other users' drafts — only show own drafts or non-drafts
    if (currentUserId) {
      conditions.push(
        or(
          ne(schema.routines.status, 'draft'),
          eq(schema.routines.creatorId, currentUserId),
        )!,
      );
    }

    const rows = await this.db
      .select({
        routine: schema.routines,
        executionTokenUsage: schema.routineExecutions.tokenUsage,
      })
      .from(schema.routines)
      .leftJoin(
        schema.routineExecutions,
        eq(schema.routines.currentExecutionId, schema.routineExecutions.id),
      )
      .where(and(...conditions))
      .orderBy(desc(schema.routines.createdAt));

    return rows.map((row) => ({
      ...row.routine,
      tokenUsage: row.executionTokenUsage ?? 0,
    }));
  }

  async getById(routineId: string, tenantId: string) {
    const routine = await this.getRoutineOrThrow(routineId, tenantId);

    // Fetch current execution with steps, interventions, deliverables
    let currentExecution: {
      execution: schema.RoutineExecution;
      steps: schema.RoutineStep[];
      interventions: schema.RoutineIntervention[];
      deliverables: schema.RoutineDeliverable[];
    } | null = null;

    if (routine.currentExecutionId) {
      const [execution] = await this.db
        .select()
        .from(schema.routineExecutions)
        .where(eq(schema.routineExecutions.id, routine.currentExecutionId))
        .limit(1);

      if (execution) {
        const steps = await this.db
          .select()
          .from(schema.routineSteps)
          .where(eq(schema.routineSteps.executionId, execution.id))
          .orderBy(schema.routineSteps.orderIndex);

        const interventions = await this.db
          .select()
          .from(schema.routineInterventions)
          .where(eq(schema.routineInterventions.executionId, execution.id));

        const deliverables = await this.db
          .select()
          .from(schema.routineDeliverables)
          .where(eq(schema.routineDeliverables.executionId, execution.id));

        currentExecution = { execution, steps, interventions, deliverables };
      }
    }

    return { ...routine, currentExecution };
  }

  async update(
    routineId: string,
    dto: UpdateRoutineDto,
    userId: string,
    tenantId: string,
  ) {
    const routine = await this.getRoutineOrThrow(routineId, tenantId);
    this.assertCreatorOwnership(routine, userId);
    return this.performUpdate(routine, routineId, dto, userId, tenantId);
  }

  /**
   * Bot-scoped update: checks that the calling bot (`botUserId`) is the
   * shadow user of the bot assigned to this routine (`routine.botId`),
   * then performs the same update logic as `update()`.
   *
   * The document identity uses the routine's `creatorId` because the bot
   * acts on behalf of the human creator.
   */
  async updateByBot(
    routineId: string,
    dto: UpdateRoutineDto,
    botUserId: string,
    tenantId: string,
  ) {
    const routine = await this.getRoutineOrThrow(routineId, tenantId);

    if (!routine.botId) {
      throw new ForbiddenException(
        'This routine has no assigned bot; bot updates are not allowed.',
      );
    }

    // Verify the caller's shadow user ID matches the bot assigned to this routine
    const [bot] = await this.db
      .select({ userId: schema.bots.userId })
      .from(schema.bots)
      .where(eq(schema.bots.id, routine.botId))
      .limit(1);

    if (!bot || bot.userId !== botUserId) {
      throw new ForbiddenException(
        'Bot is not the assigned agent for this routine',
      );
    }

    // Act on behalf of the human creator for document identity
    return this.performUpdate(
      routine,
      routineId,
      dto,
      routine.creatorId,
      tenantId,
    );
  }

  // ── Shared update logic ─────────────────────────────────────────

  private async performUpdate(
    routine: schema.Routine,
    routineId: string,
    dto: UpdateRoutineDto,
    userId: string,
    tenantId: string,
  ) {
    // Reject status transitions — status can only be the same value as current
    if (dto.status !== undefined && dto.status !== routine.status) {
      throw new BadRequestException(
        `Cannot change routine status from '${routine.status}' to '${dto.status}' via update. Use the appropriate control endpoint.`,
      );
    }

    // Handle documentContent — writes to the linked document, not the routine table
    if (dto.documentContent !== undefined) {
      if (!routine.documentId) {
        throw new BadRequestException(
          'Cannot update document content: routine has no linked document.',
        );
      }
      await this.documentsService.update(
        routine.documentId,
        { content: dto.documentContent },
        { type: 'user', id: userId },
      );
    }

    // Handle triggers — wholesale replace
    if (dto.triggers !== undefined) {
      await this.routineTriggersService.replaceAllForRoutine(
        routineId,
        dto.triggers,
        tenantId,
      );
    }

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
      .update(schema.routines)
      .set(updateData)
      .where(eq(schema.routines.id, routineId))
      .returning();

    return updated;
  }

  async delete(routineId: string, userId: string, tenantId: string) {
    const routine = await this.getRoutineOrThrow(routineId, tenantId);
    this.assertCreatorOwnership(routine, userId);

    // Drafts can always be deleted directly — no active-status guard needed
    if ((routine.status as string) === 'draft') {
      this.logger.debug(`Deleting draft routine ${routineId}`);

      // Clean up clone agent (non-fatal)
      const cloneAgentId = `routine-creation-${routineId}`;
      try {
        await this.clawHiveService.deleteAgent(cloneAgentId);
      } catch (err) {
        this.logger.warn(
          `delete: failed to delete clone agent ${cloneAgentId}: ${err}`,
        );
      }

      // Archive creation channel (non-fatal, only if no other draft shares it
      // and the channel was created around the same time as the routine)
      const creationChannelId = routine.creationChannelId;
      if (creationChannelId) {
        // Guard: don't archive a pre-existing DM that was merely reused.
        const [channelRow] = await this.db
          .select({ createdAt: schema.channels.createdAt })
          .from(schema.channels)
          .where(eq(schema.channels.id, creationChannelId))
          .limit(1);

        const routineCreatedAt = routine.createdAt?.getTime() ?? 0;
        const channelCreatedAt = channelRow?.createdAt?.getTime() ?? 0;
        const isCreationChannel =
          Math.abs(routineCreatedAt - channelCreatedAt) < 60_000;

        if (!isCreationChannel) {
          this.logger.debug(
            `delete: skipping archive of pre-existing channel ${creationChannelId} (channel predates routine by ${routineCreatedAt - channelCreatedAt}ms)`,
          );
        } else {
          const [otherDraft] = await this.db
            .select({ id: schema.routines.id })
            .from(schema.routines)
            .where(
              and(
                eq(schema.routines.creationChannelId, creationChannelId),
                ne(schema.routines.id, routineId),
                eq(schema.routines.status, 'draft'),
              ),
            )
            .limit(1);

          if (!otherDraft) {
            try {
              await this.channelsService.archiveCreationChannel(
                creationChannelId,
                tenantId,
              );
            } catch (err) {
              this.logger.warn(
                `delete: failed to archive creation channel ${creationChannelId}: ${err}`,
              );
            }
          } else {
            this.logger.debug(
              `delete: skipping channel archive — other drafts share channel ${creationChannelId}`,
            );
          }
        }
      }

      await this.db
        .delete(schema.routines)
        .where(eq(schema.routines.id, routineId));
      return { success: true };
    }

    // Prevent deletion of active routines — must stop first
    const activeStatuses: string[] = [
      'in_progress',
      'paused',
      'pending_action',
    ];
    if (activeStatuses.includes(routine.status)) {
      throw new BadRequestException(
        `Cannot delete routine in ${routine.status} status. Stop the routine first.`,
      );
    }

    await this.db
      .delete(schema.routines)
      .where(eq(schema.routines.id, routineId));

    return { success: true };
  }

  // ── Executions ──────────────────────────────────────────────────

  async getExecutions(routineId: string, tenantId: string) {
    await this.getRoutineOrThrow(routineId, tenantId);

    const executions = await this.db
      .select()
      .from(schema.routineExecutions)
      .where(eq(schema.routineExecutions.routineId, routineId))
      .orderBy(desc(schema.routineExecutions.createdAt));

    return executions;
  }

  async getExecution(routineId: string, executionId: string, tenantId: string) {
    await this.getRoutineOrThrow(routineId, tenantId);

    const [execution] = await this.db
      .select()
      .from(schema.routineExecutions)
      .where(
        and(
          eq(schema.routineExecutions.id, executionId),
          eq(schema.routineExecutions.routineId, routineId),
        ),
      )
      .limit(1);

    if (!execution) {
      throw new NotFoundException('Execution not found');
    }

    const steps = await this.db
      .select()
      .from(schema.routineSteps)
      .where(eq(schema.routineSteps.executionId, executionId))
      .orderBy(schema.routineSteps.orderIndex);

    const deliverables = await this.db
      .select()
      .from(schema.routineDeliverables)
      .where(eq(schema.routineDeliverables.executionId, executionId));

    const interventions = await this.db
      .select()
      .from(schema.routineInterventions)
      .where(eq(schema.routineInterventions.executionId, executionId));

    return { ...execution, steps, deliverables, interventions };
  }

  async getExecutionEntries(
    routineId: string,
    executionId: string,
    tenantId: string,
  ) {
    await this.getRoutineOrThrow(routineId, tenantId);

    const [execution] = await this.db
      .select()
      .from(schema.routineExecutions)
      .where(
        and(
          eq(schema.routineExecutions.id, executionId),
          eq(schema.routineExecutions.routineId, routineId),
        ),
      )
      .limit(1);

    if (!execution) {
      throw new NotFoundException('Execution not found');
    }

    const [steps, interventions, deliverables] = await Promise.all([
      this.db
        .select()
        .from(schema.routineSteps)
        .where(eq(schema.routineSteps.executionId, executionId)),
      this.db
        .select()
        .from(schema.routineInterventions)
        .where(eq(schema.routineInterventions.executionId, executionId)),
      this.db
        .select()
        .from(schema.routineDeliverables)
        .where(eq(schema.routineDeliverables.executionId, executionId)),
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
    routineId: string,
    executionId?: string,
    tenantId?: string,
  ) {
    await this.getRoutineOrThrow(routineId, tenantId);

    const conditions = [eq(schema.routineDeliverables.routineId, routineId)];
    if (executionId) {
      conditions.push(eq(schema.routineDeliverables.executionId, executionId));
    }

    const deliverables = await this.db
      .select()
      .from(schema.routineDeliverables)
      .where(and(...conditions))
      .orderBy(desc(schema.routineDeliverables.createdAt));

    return deliverables;
  }

  // ── Interventions ───────────────────────────────────────────────

  async getInterventions(routineId: string, tenantId: string) {
    await this.getRoutineOrThrow(routineId, tenantId);

    const interventions = await this.db
      .select()
      .from(schema.routineInterventions)
      .where(
        and(
          eq(schema.routineInterventions.routineId, routineId),
          eq(schema.routineInterventions.status, 'pending'),
        ),
      )
      .orderBy(desc(schema.routineInterventions.createdAt));

    return interventions;
  }

  // ── Routine Control ──────────────────────────────────────────────

  async start(
    routineId: string,
    userId: string,
    tenantId: string,
    dto: StartRoutineDto | StartRoutineNewDto,
  ) {
    const routine = await this.getRoutineOrThrow(routineId, tenantId);
    if ((routine.status as string) === 'draft') {
      throw new BadRequestException(
        'Cannot start routine in draft status. Complete creation first via POST /v1/routines/:id/complete-creation.',
      );
    }
    if (!routine.botId) {
      throw new BadRequestException(
        'Cannot start routine without an assigned bot',
      );
    }
    this.validateStatusTransition(routine.status, 'start');

    await this.publishTaskCommand({
      type: 'start',
      routineId,
      userId,
      message: dto.message,
      notes: 'notes' in dto ? dto.notes : undefined,
      triggerId: 'triggerId' in dto ? dto.triggerId : undefined,
    });

    return { success: true };
  }

  async pause(routineId: string, userId: string, tenantId: string) {
    const routine = await this.getRoutineOrThrow(routineId, tenantId);
    this.validateStatusTransition(routine.status, 'pause');

    await this.publishTaskCommand({
      type: 'pause',
      routineId,
      userId,
    });

    // Sync paused status to TaskCast (deterministic ID — no DB lookup)
    if (routine.currentExecutionId) {
      const tcId = TaskCastService.taskcastId(routine.currentExecutionId);
      await this.taskCastService.transitionStatus(tcId, 'paused');
    }

    return { success: true };
  }

  async resume(
    routineId: string,
    userId: string,
    tenantId: string,
    dto: ResumeRoutineDto,
  ) {
    const routine = await this.getRoutineOrThrow(routineId, tenantId);
    this.validateStatusTransition(routine.status, 'resume');

    await this.publishTaskCommand({
      type: 'resume',
      routineId,
      userId,
      message: dto.message,
    });

    // Sync running status to TaskCast (deterministic ID — no DB lookup)
    if (routine.currentExecutionId) {
      const tcId = TaskCastService.taskcastId(routine.currentExecutionId);
      await this.taskCastService.transitionStatus(tcId, 'in_progress');
    }

    return { success: true };
  }

  async stop(
    routineId: string,
    userId: string,
    tenantId: string,
    dto: StopRoutineDto,
  ) {
    const routine = await this.getRoutineOrThrow(routineId, tenantId);
    this.validateStatusTransition(routine.status, 'stop');

    await this.publishTaskCommand({
      type: 'stop',
      routineId,
      userId,
      message: dto.reason,
    });

    // Sync cancelled status to TaskCast (deterministic ID — no DB lookup)
    if (routine.currentExecutionId) {
      const tcId = TaskCastService.taskcastId(routine.currentExecutionId);
      await this.taskCastService.transitionStatus(tcId, 'stopped');
    }

    return { success: true };
  }

  async restart(
    routineId: string,
    userId: string,
    tenantId: string,
    dto?: { notes?: string },
  ) {
    const routine = await this.getRoutineOrThrow(routineId, tenantId);
    this.validateStatusTransition(routine.status, 'restart');

    await this.publishTaskCommand({
      type: 'restart',
      routineId,
      userId,
      notes: dto?.notes,
    });

    return { success: true };
  }

  // ── Retry ───────────────────────────────────────────────────

  async retry(
    routineId: string,
    dto: RetryExecutionDto,
    userId: string,
    tenantId: string,
  ) {
    const routine = await this.getRoutineOrThrow(routineId, tenantId);

    // Find the source execution
    const [sourceExec] = await this.db
      .select()
      .from(schema.routineExecutions)
      .where(
        and(
          eq(schema.routineExecutions.id, dto.executionId),
          eq(schema.routineExecutions.routineId, routineId),
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

    if (!routine.botId) {
      throw new BadRequestException(
        'Cannot retry routine without an assigned bot',
      );
    }

    this.validateStatusTransition(routine.status, 'retry');

    await this.publishTaskCommand({
      type: 'retry',
      routineId,
      userId,
      notes: dto.notes,
      sourceExecutionId: dto.executionId,
    });

    return { success: true };
  }

  // ── Intervention Resolution ──────────────────────────────────

  async resolveIntervention(
    routineId: string,
    interventionId: string,
    userId: string,
    tenantId: string,
    dto: ResolveInterventionDto,
  ) {
    const routine = await this.getRoutineOrThrow(routineId, tenantId);

    const [intervention] = await this.db
      .select()
      .from(schema.routineInterventions)
      .where(
        and(
          eq(schema.routineInterventions.id, interventionId),
          eq(schema.routineInterventions.routineId, routineId),
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
    if (routine.currentExecutionId !== intervention.executionId) {
      throw new BadRequestException(
        'Intervention belongs to a previous execution. Cannot resolve.',
      );
    }

    // Update the intervention
    const [updated] = await this.db
      .update(schema.routineInterventions)
      .set({
        status: 'resolved',
        resolvedBy: userId,
        resolvedAt: new Date(),
        response: { action: dto.action, message: dto.message },
      })
      .where(eq(schema.routineInterventions.id, interventionId))
      .returning();

    // Update routine status back to in_progress
    await this.db
      .update(schema.routines)
      .set({ status: 'in_progress', updatedAt: new Date() })
      .where(eq(schema.routines.id, routineId));

    // Update execution status back to in_progress (only if still pending_action)
    await this.db
      .update(schema.routineExecutions)
      .set({ status: 'in_progress' })
      .where(
        and(
          eq(schema.routineExecutions.id, intervention.executionId),
          eq(schema.routineExecutions.status, 'pending_action'),
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
      routineId,
      userId,
      message: `Intervention resolved: ${dto.action}${dto.message ? ` - ${dto.message}` : ''}`,
    });

    return updated;
  }

  // ── Creation Completion ─────────────────────────────────────────

  async completeCreation(
    routineId: string,
    dto: CompleteCreationDto,
    userId: string,
    tenantId: string,
  ) {
    // Step 1: Fetch routine (404 if missing)
    const routine = await this.getRoutineOrThrow(routineId, tenantId);

    // Step 2: Assert creator ownership (403 if not creator)
    this.assertCreatorOwnership(routine, userId);

    // Step 3: Idempotent — if already upcoming, return as-is
    if (routine.status === 'upcoming') {
      return routine;
    }

    // Step 4: Reject if status is not draft
    if (routine.status !== 'draft') {
      throw new BadRequestException(
        `Cannot complete creation of routine in '${routine.status}' status`,
      );
    }

    // Step 5: Validate required fields
    const errors: string[] = [];

    if (!routine.title || routine.title.trim() === '') {
      errors.push('title is required');
    }

    if (!routine.botId) {
      errors.push('botId is required');
    } else {
      const bot = await this.botsService.getBotById(routine.botId);
      if (!bot) {
        errors.push(
          'The executing agent no longer exists. Please reassign or delete this draft.',
        );
      }
    }

    // Check document content — documentContent lives on the linked Document,
    // not on the routines row.
    let documentContentEmpty = true;
    if (routine.documentId) {
      try {
        const doc = await this.documentsService.getById(routine.documentId);
        const content = (doc as { content?: string | null }).content;
        if (content && content.trim() !== '') {
          documentContentEmpty = false;
        }
      } catch {
        // Doc not found — treat as empty content
        documentContentEmpty = true;
      }
    }
    if (documentContentEmpty) {
      errors.push('documentContent is required');
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Missing required fields',
        errors,
      });
    }

    // Step 6: Update status to upcoming
    const [updated] = await this.db
      .update(schema.routines)
      .set({ status: 'upcoming', updatedAt: new Date() })
      .where(eq(schema.routines.id, routineId))
      .returning();

    // Step 7: Archive creation channel (non-fatal, only if no other draft shares it
    // and the channel was created around the same time as the routine)
    if (routine.creationChannelId) {
      // Guard: don't archive a pre-existing DM that was merely reused.
      // A channel created more than 60 s before the routine was not spawned
      // specifically for this routine — archiving it would destroy the user's
      // existing conversation history.
      const [channelRow] = await this.db
        .select({ createdAt: schema.channels.createdAt })
        .from(schema.channels)
        .where(eq(schema.channels.id, routine.creationChannelId))
        .limit(1);

      const routineCreatedAt = routine.createdAt?.getTime() ?? 0;
      const channelCreatedAt = channelRow?.createdAt?.getTime() ?? 0;
      const isCreationChannel =
        Math.abs(routineCreatedAt - channelCreatedAt) < 60_000;

      if (!isCreationChannel) {
        this.logger.debug(
          `completeCreation: skipping archive of pre-existing channel ${routine.creationChannelId} (channel predates routine by ${routineCreatedAt - channelCreatedAt}ms)`,
        );
      } else {
        const [otherDraft] = await this.db
          .select({ id: schema.routines.id })
          .from(schema.routines)
          .where(
            and(
              eq(schema.routines.creationChannelId, routine.creationChannelId),
              ne(schema.routines.id, routineId),
              eq(schema.routines.status, 'draft'),
            ),
          )
          .limit(1);

        if (!otherDraft) {
          try {
            await this.channelsService.archiveCreationChannel(
              routine.creationChannelId,
              tenantId,
            );
          } catch (error) {
            this.logger.warn(
              `completeCreation: failed to archive creation channel ${routine.creationChannelId} for routine ${routineId}: ${error}`,
            );
          }
        } else {
          this.logger.debug(
            `completeCreation: skipping channel archive — other drafts share channel ${routine.creationChannelId}`,
          );
        }
      }
    }

    // Step 8: Delete clone agent (non-fatal)
    const cloneAgentId = `routine-creation-${routineId}`;
    try {
      await this.clawHiveService.deleteAgent(cloneAgentId);
    } catch (error) {
      this.logger.warn(
        `completeCreation: failed to delete clone agent ${cloneAgentId} for routine ${routineId}: ${error}`,
      );
    }

    // Step 9: Log completion
    this.logger.log(
      `completeCreation: routine ${routineId} transitioned to upcoming${dto.notes ? ` — notes: ${dto.notes}` : ''}`,
    );

    return updated;
  }

  // ── Creation Task ───────────────────────────────────────────────

  async createWithCreationTask(
    dto: CreateWithCreationTaskDto,
    userId: string,
    tenantId: string,
  ): Promise<{
    routineId: string;
    creationChannelId: string;
    creationSessionId: string;
  }> {
    // Step 1: Validate source bot exists
    const sourceBot = await this.botsService.getBotById(dto.agentId);
    if (!sourceBot) {
      throw new NotFoundException(`Bot not found: ${dto.agentId}`);
    }

    // Step 2: Validate bot belongs to tenant via bots JOIN installed_applications
    const [botTenantRow] = await this.db
      .select({ tenantId: schema.installedApplications.tenantId })
      .from(schema.bots)
      .leftJoin(
        schema.installedApplications,
        eq(schema.bots.installedApplicationId, schema.installedApplications.id),
      )
      .where(eq(schema.bots.id, dto.agentId))
      .limit(1);

    if (!botTenantRow || botTenantRow.tenantId !== tenantId) {
      throw new BadRequestException(
        'Bot does not belong to the current tenant',
      );
    }

    // Step 3: Get source agent from claw-hive
    const agentId = (sourceBot.managedMeta as Record<string, unknown> | null)
      ?.agentId as string | undefined;
    if (!agentId) {
      throw new BadRequestException(
        'Bot is not a managed hive agent (no agentId in managedMeta)',
      );
    }
    // Cast to bypass stale type resolution in pnpm workspaces / worktrees environment
    const sourceAgent = await (
      this.clawHiveService as unknown as {
        getAgent: (
          agentId: string,
          tenantId?: string,
        ) => Promise<{
          id: string;
          name: string;
          blueprintId: string;
          tenantId: string;
          model: { provider: string; id: string };
          componentConfigs: Record<string, Record<string, unknown>>;
          metadata?: Record<string, unknown>;
        } | null>;
      }
    ).getAgent(agentId, tenantId);
    if (!sourceAgent) {
      throw new BadRequestException(
        `Source agent not found in claw-hive: ${agentId}`,
      );
    }

    // Step 4: Auto-generate title: count existing routines in tenant.
    // TODO: This has a race condition — concurrent calls can produce
    // duplicate titles (e.g., two "Routine #6"). Titles are not unique-
    // constrained so this is cosmetically annoying but not broken.
    // Consider using a DB sequence or atomic INSERT...SELECT if it
    // becomes a problem in practice.
    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.routines)
      .where(eq(schema.routines.tenantId, tenantId));
    const count = Number(countRow?.count ?? 0);
    const title = `Routine #${count + 1}`;

    // Step 5: Create draft routine
    const draft = await this.create(
      { title, botId: dto.agentId, status: 'draft' },
      userId,
      tenantId,
    );

    // Steps 6-10: with rollback on failure
    let cloneRegistered = false;
    const cloneAgentId = `routine-creation-${draft.id}`;

    try {
      // Step 6: Create/reuse DM channel between user and bot shadow user
      const channel = await this.channelsService.createDirectChannel(
        userId,
        sourceBot.userId,
        tenantId,
      );

      // Step 7: Build deterministic session ID
      const sessionId = `team9/${tenantId}/routine-creation-${draft.id}/dm/${channel.id}`;

      // Step 8: Register clone agent
      await this.clawHiveService.registerAgent({
        id: cloneAgentId,
        name: `Routine Creation - ${title}`,
        blueprintId: sourceAgent.blueprintId,
        tenantId,
        model: sourceAgent.model,
        componentConfigs: {
          ...sourceAgent.componentConfigs,
          'team9-routine-creation': {
            routineId: draft.id,
            isCreationChannel: true,
          },
        },
      });
      cloneRegistered = true;

      // Step 9: Persist creation metadata
      await this.db
        .update(schema.routines)
        .set({
          creationChannelId: channel.id,
          creationSessionId: sessionId,
          updatedAt: new Date(),
        } as Record<string, unknown>)
        .where(eq(schema.routines.id, draft.id));

      // Step 10: Send kickoff event
      await this.clawHiveService.sendInput(
        sessionId,
        {
          type: 'team9:routine-creation.start',
          source: 'team9',
          timestamp: new Date().toISOString(),
          payload: {
            routineId: draft.id,
            creatorUserId: userId,
            tenantId,
            title,
          },
        },
        tenantId,
      );

      return {
        routineId: draft.id,
        creationChannelId: channel.id,
        creationSessionId: sessionId,
      };
    } catch (error) {
      // Rollback: delete clone agent if registered
      if (cloneRegistered) {
        try {
          await this.clawHiveService.deleteAgent(cloneAgentId);
        } catch (deleteError) {
          this.logger.error(
            `createWithCreationTask: failed to delete clone agent ${cloneAgentId} during rollback: ${deleteError}`,
          );
        }
      }

      // Rollback: delete draft routine row. Note: the document created
      // by this.create() is intentionally NOT deleted — orphaned documents
      // are low-risk (not user-visible, can be GC'd by a future cleanup
      // job) and deleting them here would add complexity for a rare path.
      try {
        await this.db
          .delete(schema.routines)
          .where(eq(schema.routines.id, draft.id));
      } catch (deleteError) {
        this.logger.error(
          `createWithCreationTask: failed to delete draft routine ${draft.id} during rollback: ${deleteError}`,
        );
      }

      throw error;
    }
  }

  // ── Internal helpers ────────────────────────────────────────────

  private async getRoutineOrThrow(
    id: string,
    tenantId?: string,
  ): Promise<schema.Routine> {
    const conditions = [eq(schema.routines.id, id)];
    if (tenantId) {
      conditions.push(eq(schema.routines.tenantId, tenantId));
    }

    const [routine] = await this.db
      .select()
      .from(schema.routines)
      .where(and(...conditions))
      .limit(1);

    if (!routine) {
      throw new NotFoundException('Routine not found');
    }

    return routine;
  }

  private assertCreatorOwnership(
    routine: schema.Routine,
    userId: string,
  ): void {
    if (routine.creatorId !== userId) {
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
      retry: ['completed', 'failed', 'timeout', 'stopped'],
    };
    if (!allowed[action]?.includes(currentStatus)) {
      throw new BadRequestException(
        `Cannot ${action} routine in ${currentStatus} status`,
      );
    }
  }

  private async publishTaskCommand(command: {
    type: string;
    routineId: string;
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
        `Published task command: ${command.type} for routine ${command.routineId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to publish task command: ${error}`);
      throw error;
    }
  }
}
