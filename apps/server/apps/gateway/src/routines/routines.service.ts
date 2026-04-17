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
  isNull,
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

    // Prevent deletion of active routines — must stop first.
    // Drafts bypass this guard (they have no execution state).
    if ((routine.status as string) !== 'draft') {
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
    }

    // Hard-delete the linked routine-session channel, regardless of whether
    // the routine is a draft, upcoming, completed, failed, etc. The FK on
    // routine.creation_channel_id only clears the routine's column on
    // channel deletion — it does NOT cascade the other way. Without an
    // explicit hard-delete here, archived creation channels from completed
    // routines would accumulate with no remaining back-reference.
    //
    // Non-fatal on failure: the routine row is still deleted even if
    // channel cleanup fails. Orphaned channels can be reaped by a later
    // maintenance job.
    if (routine.creationChannelId) {
      try {
        await this.channelsService.hardDeleteRoutineSessionChannel(
          routine.creationChannelId,
          tenantId,
        );
      } catch (e) {
        this.logger.warn(
          `delete: failed to hard-delete creation channel ${routine.creationChannelId} for routine ${routineId}: ${e}`,
        );
      }
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

    // Step 3: Idempotent — if already upcoming, return as-is.
    // BUT first retry channel archival if it still looks unarchived.
    // An earlier completeCreation call may have transitioned status to
    // upcoming and then failed to archive (non-fatal), leaving the
    // creation channel permanently unarchived. This heals on retry.
    if (routine.status === 'upcoming') {
      if (routine.creationChannelId) {
        try {
          await this.channelsService.archiveCreationChannel(
            routine.creationChannelId,
            tenantId,
          );
        } catch (e) {
          this.logger.warn(
            `completeCreation (idempotent): failed to archive creation channel ${routine.creationChannelId} for routine ${routineId}: ${e}`,
          );
        }
      }
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

    // Step 6: Conditionally update status to upcoming only if still draft.
    // Using WHERE id=? AND status='draft' with RETURNING lets us detect a
    // concurrent caller that already flipped the status — empty result means
    // we lost the race and must NOT dispatch autoRunFirst a second time.
    const [updated] = await this.db
      .update(schema.routines)
      .set({ status: 'upcoming', updatedAt: new Date() })
      .where(
        and(
          eq(schema.routines.id, routineId),
          eq(schema.routines.status, 'draft'),
        ),
      )
      .returning();

    if (!updated) {
      // Lost the race — another concurrent caller already flipped this draft
      // to upcoming. Fall back to the idempotent behaviour: archive channel
      // best-effort, do NOT dispatch autoRunFirst (the winner already did or
      // chose not to), and return the current routine state.
      const winner = await this.getRoutineOrThrow(routineId, tenantId);
      if (winner.creationChannelId) {
        try {
          await this.channelsService.archiveCreationChannel(
            winner.creationChannelId,
            tenantId,
          );
        } catch (e) {
          this.logger.warn(
            `completeCreation (race-loss): failed to archive creation channel ${winner.creationChannelId} for routine ${routineId}: ${e}`,
          );
        }
      }
      this.logger.log(
        `completeCreation: routine ${routineId} race-loss; another caller already finalized`,
      );
      return winner;
    }

    // Step 7a: archive the creation channel (best-effort, non-fatal)
    if (routine.creationChannelId) {
      try {
        await this.channelsService.archiveCreationChannel(
          routine.creationChannelId,
          tenantId,
        );
      } catch (e) {
        this.logger.warn(
          `completeCreation: failed to archive creation channel ${routine.creationChannelId} for routine ${routineId}: ${e}`,
        );
      }
    }

    // Step 7: Log completion
    this.logger.log(
      `completeCreation: routine ${routineId} transitioned to upcoming${dto.notes ? ` — notes: ${dto.notes}` : ''}`,
    );

    // Step 8: optionally dispatch one manual execution if the agent
    // requested it. Best-effort — failure is logged but does not roll back
    // the finalize (the user can still trigger from the dashboard).
    if (dto.autoRunFirst === true) {
      try {
        await this.start(routineId, userId, tenantId, {
          message: 'Auto-run after routine creation',
        } as StartRoutineDto);
      } catch (e) {
        this.logger.warn(
          `completeCreation: autoRunFirst dispatch failed for routine ${routineId}: ${e}`,
        );
      }
    }

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
    // Step 1: validate source bot exists
    const sourceBot = await this.botsService.getBotById(dto.agentId);
    if (!sourceBot) {
      throw new NotFoundException(`Bot not found: ${dto.agentId}`);
    }

    // Step 2: validate bot belongs to tenant via bots JOIN installed_applications
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

    // Step 3: fast-fail if managedMeta.agentId is missing (startCreationSession
    // will re-check this, but failing early avoids creating a draft row that
    // can't materialize a channel)
    const agentId = (sourceBot.managedMeta as Record<string, unknown> | null)
      ?.agentId as string | undefined;
    if (!agentId) {
      throw new BadRequestException(
        'Bot is not a managed hive agent (no agentId in managedMeta)',
      );
    }

    // Step 4: auto title (count existing routines)
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

    // NOTE: This path intentionally allows multiple concurrent draft
    // routines per (user, bot). Drafts are a first-class entity — a user
    // can plausibly be building several different routines with the same
    // personal assistant at once (e.g. "weekly report" and "daily standup
    // summary"). An earlier version of this flow rejected the second
    // `with-creation-task` call with a 400 here, which was both semantically
    // wrong and a one-way trap: a single stuck draft (claw-hive failure,
    // user closing the browser mid-bootstrap, etc.) blocked ALL future
    // creations against that bot with no in-UI recovery path. If
    // accidental double-creation becomes a real problem the right place
    // to fix it is the client (disable the button while the request is
    // pending) and the drafts list UI (surface existing drafts so the
    // user can pick one up instead of starting a fresh one).

    // Step 5: create draft routine
    const draft = await this.create(
      { title, botId: dto.agentId, status: 'draft' },
      userId,
      tenantId,
    );

    // Step 6: materialize creation session (channel + event + persist ids)
    try {
      const session = await this.startCreationSession(
        draft.id,
        userId,
        tenantId,
      );
      return {
        routineId: draft.id,
        creationChannelId: session.creationChannelId,
        creationSessionId: session.creationSessionId,
      };
    } catch (error) {
      // Rollback the draft row. The draft document is intentionally not deleted —
      // orphaned documents are low-risk (not user-visible, can be GC'd by a
      // future cleanup job) and deleting them here would add complexity for a
      // rare path.
      try {
        await this.db
          .delete(schema.routines)
          .where(eq(schema.routines.id, draft.id));
      } catch (rollbackErr) {
        this.logger.error(
          `createWithCreationTask: failed to delete draft routine ${draft.id} during rollback: ${rollbackErr}`,
        );
      }
      throw error;
    }
  }

  async startCreationSession(
    routineId: string,
    userId: string,
    tenantId: string,
  ): Promise<{ creationChannelId: string; creationSessionId: string }> {
    // Validate routine + ownership + status
    const routine = await this.getRoutineOrThrow(routineId, tenantId);
    this.assertCreatorOwnership(routine, userId);

    if (routine.status !== 'draft') {
      throw new BadRequestException(
        `Cannot start creation session for routine in '${routine.status}' status`,
      );
    }

    // Fast idempotent path (optimistic — revalidated atomically below).
    // BUT only trust the persisted ids if the channel is actually a
    // routine-session. Legacy Phase 1 drafts could point at a 'direct'
    // DM channel; returning those would make the user land on their
    // regular DM with the bot instead of a dedicated session. In that
    // case we clear the legacy ids and fall through to materialize a
    // fresh routine-session channel.
    if (routine.creationChannelId && routine.creationSessionId) {
      const [existingChannel] = await this.db
        .select({ type: schema.channels.type })
        .from(schema.channels)
        .where(eq(schema.channels.id, routine.creationChannelId))
        .limit(1);

      if (existingChannel?.type === 'routine-session') {
        return {
          creationChannelId: routine.creationChannelId,
          creationSessionId: routine.creationSessionId,
        };
      }

      // Legacy or missing channel — clear the stale back-reference so
      // the atomic claim below matches (we now only predicate on
      // creation_channel_id IS NULL, so we need to null it first).
      await this.db
        .update(schema.routines)
        .set({
          creationChannelId: null,
          creationSessionId: null,
          updatedAt: new Date(),
        } as Record<string, unknown>)
        .where(eq(schema.routines.id, routineId));
    }

    if (!routine.botId) {
      throw new BadRequestException(
        'Draft routine has no botId — cannot start creation session',
      );
    }

    // Validate bot + tenant ownership + managed agent id.
    // The compound path (createWithCreationTask) does this check as
    // pre-flight; the lazy path (DraftRoutineCard) must repeat it because
    // the bot.botId on an existing draft row may point at a bot that has
    // since been reassigned or moved to another tenant.
    const [botTenantRow] = await this.db
      .select({ tenantId: schema.installedApplications.tenantId })
      .from(schema.bots)
      .leftJoin(
        schema.installedApplications,
        eq(schema.bots.installedApplicationId, schema.installedApplications.id),
      )
      .where(eq(schema.bots.id, routine.botId))
      .limit(1);

    if (!botTenantRow || botTenantRow.tenantId !== tenantId) {
      throw new BadRequestException(
        'Draft bot does not belong to the current tenant',
      );
    }

    const bot = await this.botsService.getBotById(routine.botId);
    if (!bot) {
      throw new BadRequestException(
        'The executing agent no longer exists. Reassign or delete this draft.',
      );
    }
    const agentId = (bot.managedMeta as Record<string, unknown> | null)
      ?.agentId as string | undefined;
    if (!agentId) {
      throw new BadRequestException(
        'Bot is not a managed hive agent (no agentId in managedMeta)',
      );
    }

    // Fetch document content as best-effort enrichment for the kickoff payload.
    let draftDocumentContent: string | null = null;
    if (routine.documentId) {
      try {
        const doc = await this.documentsService.getById(routine.documentId);
        const content = (doc as { content?: string | null }).content;
        if (typeof content === 'string' && content.length > 0) {
          draftDocumentContent = content;
        }
      } catch (err) {
        // Best-effort enrichment; if the document fetch fails, leave null.
        this.logger.warn(
          `startCreationSession: failed to fetch draft documentContent for routine ${routineId}: ${err}`,
        );
      }
    }

    // Fetch existing triggers as best-effort enrichment so the agent can
    // render an accurate state (e.g. "1 trigger configured") instead of
    // showing "0 configured" for drafts that already have triggers.
    let draftTriggers: unknown[] = [];
    try {
      draftTriggers = await this.routineTriggersService.listByRoutine(
        routineId,
        tenantId,
      );
    } catch (err) {
      this.logger.warn(
        `startCreationSession: failed to fetch draft triggers for routine ${routineId}: ${err}`,
      );
    }

    // Build channel speculatively. The conditional UPDATE below is the
    // race gate — if two concurrent callers both reach this point, both
    // create channels, and the loser hard-deletes its own.
    const channel = await this.channelsService.createRoutineSessionChannel({
      creatorId: userId,
      botUserId: bot.userId,
      tenantId,
      routineId,
      purpose: 'creation',
    });

    const sessionId = `team9/${tenantId}/${agentId}/dm/${channel.id}`;
    let claimed = false;
    let sessionCreated = false;

    try {
      // ATOMIC CLAIM: only succeed if creation_channel_id is still null.
      // We deliberately do NOT predicate on creation_session_id being
      // null — a half-populated row (channel null, session set) is a
      // rollback residue from an older bug, and this UPDATE heals it by
      // overwriting both fields. Drizzle returns the updated rows; an
      // empty array means we lost the race for this routine.
      const claimResult = await this.db
        .update(schema.routines)
        .set({
          creationChannelId: channel.id,
          creationSessionId: sessionId,
          updatedAt: new Date(),
        } as Record<string, unknown>)
        .where(
          and(
            eq(schema.routines.id, routineId),
            isNull(schema.routines.creationChannelId),
          ),
        )
        .returning({ id: schema.routines.id });

      if (claimResult.length === 0) {
        // Lost the race: a concurrent caller already claimed this draft.
        // Hard-delete our speculative channel and return the winner's ids.
        await this.channelsService
          .hardDeleteRoutineSessionChannel(channel.id, tenantId)
          .catch((cleanupError) => {
            this.logger.error(
              `startCreationSession: race-loss channel cleanup failed for ${channel.id}: ${cleanupError}`,
            );
          });

        const winner = await this.getRoutineOrThrow(routineId, tenantId);
        if (winner.creationChannelId && winner.creationSessionId) {
          // KNOWN LIMITATION (rare²): we return the winner's ids before
          // the winner's sendInput() has committed. If the winner's
          // kickoff then fails, its catch-block clears these columns and
          // hard-deletes the channel. By that point we have already
          // returned stale ids to our caller. The caller will then try
          // to open a channel that no longer exists and hit a 404 — user
          // retry reliably recovers. Acceptable for P0 because it
          // requires concurrent callers AND transient Hive failure on
          // the winner. A proper fix would serialize on a pg advisory
          // lock or add an `is_ready` marker that the winner sets
          // after sendInput succeeds.
          return {
            creationChannelId: winner.creationChannelId,
            creationSessionId: winner.creationSessionId,
          };
        }
        // Winner exists but its state got rolled back between claim and
        // read — caller should retry.
        throw new BadRequestException(
          'Concurrent creation session in unstable state; retry',
        );
      }

      claimed = true;

      const team9Context: Record<string, unknown> = {
        routineId,
        creatorUserId: userId,
        creationChannelId: channel.id,
        isCreationChannel: true,
      };

      await this.clawHiveService.createSession(
        agentId,
        { userId, sessionId, team9Context },
        tenantId,
      );
      sessionCreated = true;

      await this.clawHiveService.sendInput(
        sessionId,
        {
          type: 'team9:routine-creation.start',
          source: 'team9',
          timestamp: new Date().toISOString(),
          payload: {
            routineId,
            creatorUserId: userId,
            tenantId,
            creationChannelId: channel.id,
            title: routine.title,
            description: routine.description ?? null,
            documentContent: draftDocumentContent,
            botId: routine.botId,
            triggers: draftTriggers,
          },
        },
        tenantId,
      );

      return { creationChannelId: channel.id, creationSessionId: sessionId };
    } catch (error) {
      // Rollback path. Two sub-cases:
      //   a) We never claimed the row (pre-claim failure) → just delete
      //      the speculative channel. The routine row is untouched.
      //   b) We claimed the row (sendInput failed) → delete the channel
      //      AND explicitly null BOTH columns on the routine. We cannot
      //      rely on FK ON DELETE SET NULL to clear creation_session_id
      //      because that FK only covers creation_channel_id.
      try {
        await this.channelsService.hardDeleteRoutineSessionChannel(
          channel.id,
          tenantId,
        );
      } catch (cleanupError) {
        this.logger.error(
          `startCreationSession: failed to roll back channel ${channel.id}: ${cleanupError}`,
        );
      }

      if (claimed) {
        try {
          await this.db
            .update(schema.routines)
            .set({
              creationChannelId: null,
              creationSessionId: null,
              updatedAt: new Date(),
            } as Record<string, unknown>)
            .where(
              and(
                eq(schema.routines.id, routineId),
                // Defensive: only clear if we still own the claim.
                eq(schema.routines.creationSessionId, sessionId),
              ),
            );
        } catch (clearError) {
          this.logger.error(
            `startCreationSession: failed to clear creation_channel_id/creation_session_id on routine ${routineId}: ${clearError}`,
          );
        }
      }

      if (sessionCreated) {
        // Best-effort cleanup: deleteSession already swallows 404 internally
        // (session already gone). Log any other failure but do not re-throw —
        // the original error must propagate to the caller unchanged.
        try {
          await this.clawHiveService.deleteSession(sessionId, tenantId);
        } catch (sessionCleanupError) {
          this.logger.error(
            `startCreationSession: failed to roll back Hive session ${sessionId}: ${sessionCleanupError}`,
          );
        }
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
