import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ServiceUnavailableException,
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
import { WS_EVENTS } from '@team9/shared';
import { WEBSOCKET_GATEWAY } from '../shared/constants/injection-tokens.js';
import type { WebsocketGateway } from '../im/websocket/websocket.gateway.js';
import { DocumentsService } from '../documents/documents.service.js';
import { ChannelsService } from '../im/channels/channels.service.js';
import { ClawHiveService, type HiveSessionDetail } from '@team9/claw-hive';
import { appMetrics } from '@team9/observability';
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
import type { FolderCommitDto } from './dto/folder-commit.dto.js';
import type {
  Folder9BlobResponse,
  Folder9CommitResponse,
  Folder9LogEntry,
  Folder9Permission,
  Folder9TreeEntry,
} from '../wikis/types/folder9.types.js';
import { TaskCastService } from './taskcast.service.js';
import { UsersService } from '../im/users/users.service.js';
import { Folder9ClientService } from '../wikis/folder9-client.service.js';
import {
  provisionFolder9SkillFolder,
  slugifyUuid,
} from './folder/provision-routine-folder.js';
import { ensureRoutineFolder } from './folder/ensure-routine-folder.js';
import { validateSkillMd } from './folder/validate-skill-md.js';

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
    @Inject(WEBSOCKET_GATEWAY)
    private readonly wsGateway: WebsocketGateway,
    private readonly documentsService: DocumentsService,
    private readonly amqpConnection: AmqpConnection,
    private readonly routineTriggersService: RoutineTriggersService,
    private readonly taskCastService: TaskCastService,
    private readonly channelsService: ChannelsService,
    private readonly clawHiveService: ClawHiveService,
    private readonly botsService: BotService,
    private readonly usersService: UsersService,
    private readonly folder9Client: Folder9ClientService,
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

    // Always create a linked document for the routine. The Document is the
    // legacy storage for the routine body; folder9 SKILL.md is the new
    // storage and is provisioned atomically below. We keep the Document as
    // an empty stub during the A.x migration so existing readers
    // (routine-bot.service.ts: getRoutineById enrichment, completeCreation
    // validation, draft session kickoff payload) keep working until they
    // are migrated to read SKILL.md instead.
    //
    // documentContent has been dropped from CreateRoutineDto. Initial
    // content is always empty — agents/users add content via the routine
    // refinement flow (PATCH /v1/routines/:id with `documentContent` on
    // routine-bot.service still wires through documentsService for now).
    const doc = await this.documentsService.create(
      {
        documentType: 'task',
        content: '',
        title: dto.title,
      },
      { type: 'user', id: userId },
      tenantId,
    );
    const documentId = doc.id;

    // ── INSERT (short tx) → provision (no tx) → UPDATE folderId (short tx) ──
    //
    // Previously this whole flow ran inside a single `db.transaction()`,
    // pinning a Postgres connection across folder9's 3 sequential HTTP
    // roundtrips (~75s worst-case timeout). That serialized concurrent
    // reads on the same routine and starved the pool under folder9
    // outages. The current shape is:
    //
    //   1. Short tx (or implicit autocommit): INSERT routine row with
    //      folderId NULL. Commits immediately so the row is visible.
    //   2. NO TX: provision folder9 (long HTTP I/O).
    //   3. Short UPDATE: claim folderId. If provision/UPDATE fails AFTER
    //      the INSERT, the row exists with NULL folderId — `ensureRoutineFolder`
    //      will lazy-provision on the next access, so the orphan-row
    //      case heals itself naturally.
    //
    // Caller-facing contract is preserved: folder9 failure ⇒ 503, and
    // there is no half-baked routine in the caller's view. We achieve
    // that by best-effort DELETE-ing the just-INSERTed row before
    // throwing; if the DELETE itself fails we still throw 503 (lazy
    // provision will heal the row on next access — the routine reappears
    // for the user with the same id, but that's acceptable: the next
    // /v1/routines/:id read transparently provisions and returns it).
    //
    // Triggers: drafts skip trigger registration (existing rule). For
    // non-drafts, trigger creation runs AFTER the row has its folderId
    // claimed — a trigger failure leaves a fully-provisioned routine
    // (the caller can retry trigger setup later), matching the legacy
    // best-effort behaviour.
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
    // status, sourceRef, and folderId are new schema columns added in
    // Task 0 / Task A.1 — cast to bypass stale type resolution in pnpm
    // workspaces / worktrees environment.
    (insertValues as Record<string, unknown>).status = status;
    (insertValues as Record<string, unknown>).sourceRef =
      options?.sourceRef ?? null;
    (insertValues as Record<string, unknown>).folderId = null;

    // ── Step 1: INSERT (immediate commit, folderId NULL) ──
    const [routine] = await this.db
      .insert(schema.routines)
      .values(insertValues)
      .returning();

    // ── Step 2: provision OUTSIDE any tx ──
    let provisioned: { folderId: string };
    try {
      provisioned = await provisionFolder9SkillFolder(
        {
          id: routine.id,
          title: routine.title,
          description: routine.description,
          // documentContent is a virtual field on the helper's input;
          // pass null so the helper emits an "Initial scaffold" commit
          // message and an empty SKILL.md body.
          documentContent: null,
        },
        {
          folder9Client: this.folder9Client,
          workspaceId: tenantId,
          // Folder9ClientService reads FOLDER9_PSK from process.env;
          // this field is retained for forward-compat with the helper's
          // public deps shape but currently unused by the underlying
          // client. See provision-routine-folder.ts header.
          psk: '',
        },
      );
    } catch (err) {
      // Metric: per-failure counter that pairs with the request-rate
      // alert in §10.8 of the design doc.
      appMetrics.routinesCreateFolder9FailureTotal.add(1);
      this.logger.warn(
        `create: folder9 provision failed for routine ${routine.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );

      // Best-effort cleanup: delete the just-INSERTed row so the caller
      // doesn't see a half-baked routine. If this DELETE itself fails
      // we still throw 503 — lazy-provision in `ensureRoutineFolder`
      // will heal the row on next access.
      try {
        await this.db
          .delete(schema.routines)
          .where(eq(schema.routines.id, routine.id));
      } catch (delErr) {
        this.logger.error(
          `create: best-effort cleanup DELETE failed for routine ${
            routine.id
          } after folder9 failure: ${
            delErr instanceof Error ? delErr.message : String(delErr)
          }. Lazy provision will heal on next access.`,
        );
      }

      throw new ServiceUnavailableException(
        'folder storage temporarily unavailable, please retry',
      );
    }

    // ── Step 3: short UPDATE to claim folderId ──
    try {
      await this.db
        .update(schema.routines)
        .set({
          folderId: provisioned.folderId,
          updatedAt: new Date(),
        } as Record<string, unknown>)
        .where(eq(schema.routines.id, routine.id));
    } catch (updateErr) {
      // The folderId UPDATE failed AFTER folder9 provisioning succeeded.
      // The folder is already created on folder9; we just couldn't
      // record its id locally. Log loudly and rethrow as 503 — the
      // orphan folder will be reaped by GC, and `ensureRoutineFolder`
      // will provision a fresh folder on the next access.
      appMetrics.routinesCreateFolder9FailureTotal.add(1);
      this.logger.error(
        `create: UPDATE folderId failed for routine ${routine.id} after folder9 success (folder ${provisioned.folderId} will be GC'd): ${
          updateErr instanceof Error ? updateErr.message : String(updateErr)
        }`,
      );
      try {
        await this.db
          .delete(schema.routines)
          .where(eq(schema.routines.id, routine.id));
      } catch (delErr) {
        this.logger.error(
          `create: best-effort cleanup DELETE failed for routine ${
            routine.id
          } after UPDATE failure: ${
            delErr instanceof Error ? delErr.message : String(delErr)
          }`,
        );
      }
      throw new ServiceUnavailableException(
        'folder storage temporarily unavailable, please retry',
      );
    }

    // ── Triggers: best-effort, post-folder-claim ──
    if ((status as string) !== 'draft' && dto.triggers?.length) {
      await this.routineTriggersService.createBatch(
        routineId,
        dto.triggers,
        tenantId,
      );
    }

    return { ...routine, folderId: provisioned.folderId };
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

    // documentContent was dropped from UpdateRoutineDto in Phase A.1 and
    // the create-side bridge was removed in A.4. The new world stores the
    // routine body in folder9 SKILL.md, not in the linked Document — the
    // proxy endpoints in A.6 handle SKILL.md writes. There is no
    // documentContent branch on the user-facing PATCH path anymore.

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

    await this.wsGateway.broadcastToWorkspace(
      routine.tenantId,
      WS_EVENTS.ROUTINE.UPDATED,
      { routineId },
    );

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

    // Broadcast so clients refetch the routines list — the deleted row
    // won't be in the new response, so the UI removes it naturally.
    // Emitted AFTER the DB delete succeeds; if the delete throws the
    // method propagates and no emit fires.
    await this.wsGateway.broadcastToWorkspace(
      routine.tenantId,
      WS_EVENTS.ROUTINE.UPDATED,
      { routineId },
    );

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

    // NOTE: the legacy "documentContent is required" gate was REMOVED
    // (I1 from code review). With A.4 the routine body of truth lives in
    // SKILL.md inside the folder9 folder; the legacy `documents` table
    // is a stub for migration compatibility and no longer carries
    // authoritative content. The "agent never wrote anything" case is
    // covered by Step 5b (SKILL.md validation) via the `body_empty` /
    // `body_too_short` rules, so a separate documents-table gate would
    // double-fail new-world routines.

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Missing required fields',
        errors,
      });
    }

    // ── Step 5b: SKILL.md validation (A.5) ───────────────────────────
    //
    // Now that the legacy required-field gate has passed, ensure the
    // routine has a folder9 folder and that the agent populated SKILL.md
    // correctly. `ensureRoutineFolder` is the Layer 2 invariant: after it
    // returns, `routine.folderId` is guaranteed non-null. We then mint a
    // short-lived read-scoped token and fetch SKILL.md, run the
    // validation, and on any rule violation return `{ success: false,
    // error }` so the calling agent can fix the file and retry via the
    // `finishRoutineCreation` tool (no 4xx — surfaces cleanly through the
    // tool result channel).
    //
    // We pass `null` for `documentContent` to the underlying provision
    // helper indirectly via ensureRoutineFolder's internal default. The
    // very first call here will lazily create the folder with an empty
    // SKILL.md scaffold — that scaffold WILL fail this validation
    // (frontmatter description doesn't match the routine description if
    // the routine has one, OR body is too short). That's the correct
    // behaviour: the agent then fills in the content and retries.
    const ensured = await ensureRoutineFolder(routineId, {
      db: this.db,
      provisionDeps: {
        folder9Client: this.folder9Client,
        workspaceId: routine.tenantId,
        psk: '',
      },
    });

    // Mint a 5-minute read token. The validation reads SKILL.md exactly
    // once on this code path, so a tight TTL caps the leak window if a
    // log scrape ever surfaces the token. `name` is descriptive for
    // folder9-side audit; `created_by` namespaces routine activity from
    // wiki activity for traceability.
    const readToken = await this.folder9Client.createToken({
      folder_id: ensured.folderId!,
      permission: 'read',
      name: 'routine-finish-validate',
      created_by: `routine:${routineId}`,
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    });

    let skillMdContent: string;
    try {
      const blob = await this.folder9Client.getBlob(
        routine.tenantId,
        ensured.folderId!,
        readToken.token,
        'SKILL.md',
      );
      // folder9 returns base64-encoded content for non-UTF8 blobs. SKILL.md
      // must be plain text — anything else is treated as missing/invalid.
      skillMdContent =
        blob.encoding === 'text'
          ? blob.content
          : Buffer.from(blob.content, 'base64').toString('utf8');
    } catch (err) {
      // Treat a SKILL.md read miss as a validation failure with the
      // synthetic rule `read_failed` — same metric, same alert pipeline,
      // distinct label so dashboards can split "agent never wrote the
      // file" from "agent wrote the file but it failed validation".
      // The rule code intentionally lives outside the
      // ValidationFailureRule union (which is reserved for
      // validateSkillMd's bounded set); it's still a stable, low-
      // cardinality value that fits the same label.
      appMetrics.routinesCompleteCreationValidationFailureTotal.add(1, {
        rule: 'read_failed',
      });
      this.logger.warn(
        `completeCreation: failed to read SKILL.md for routine ${routineId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return {
        success: false as const,
        error:
          'SKILL.md could not be read from the routine folder. Please write the file before finishing creation.',
      };
    }

    const expectedSkillName = `routine-${slugifyUuid(routineId)}`;
    // Use `ensured.description` — the row read INSIDE the
    // ensureRoutineFolder transaction. That's the freshest authoritative
    // value (the row was SELECT ... FOR UPDATE locked at provision time),
    // so it cannot be stale relative to whatever the agent saw when it
    // wrote SKILL.md.
    //
    // Fallback policy MUST mirror provisionFolder9SkillFolder's
    // normalize-then-fallback logic — otherwise a routine with a null
    // (or whitespace-only) description gets seeded with one string in
    // SKILL.md, but the validator expects a different one, which
    // fails BOTH `description_empty` (non-empty required) AND
    // `description_mismatch` (must equal). The fallback uses a dash
    // separator (no `: `) because a colon-followed-by-space in an
    // unquoted YAML scalar parses as a nested mapping and breaks
    // validation. Keep this string in sync with the fallback in
    // provision-routine-folder.ts#provisionFolder9SkillFolder.
    const trimmedDescription = ensured.description?.trim() ?? '';
    const expectedDescription =
      trimmedDescription.length > 0
        ? trimmedDescription
        : `Generated from routine - ${ensured.title}`;
    const validation = validateSkillMd(
      skillMdContent,
      expectedSkillName,
      expectedDescription,
    );
    if (!validation.ok) {
      // `validation.rule` is one of the closed-set codes in
      // ValidationFailureRule — safe to use directly as a metric label
      // without high-cardinality concerns.
      appMetrics.routinesCompleteCreationValidationFailureTotal.add(1, {
        rule: validation.rule,
      });
      this.logger.log(
        `completeCreation: SKILL.md validation rejected routine ${routineId}: ${validation.reason}`,
      );
      return { success: false as const, error: validation.reason };
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
      // chose not to), and return the current routine state. Skip the WS
      // broadcast too — the winner has already emitted routine:updated.
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

    // Broadcast the draft → upcoming transition so clients refetch and
    // surface the newly activated routine in the list. Placed AFTER the
    // race-loss guard so only the winner emits, and BEFORE the best-effort
    // channel archive — if the status flip itself throws, no emit fires.
    // Using the DB-verified tenantId from the fetched routine, not the param.
    await this.wsGateway.broadcastToWorkspace(
      routine.tenantId,
      WS_EVENTS.ROUTINE.UPDATED,
      { routineId },
    );

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

  private buildRoutineCreationTeam9Context(params: {
    routineId: string;
    userId: string;
    channelId: string;
    locale: { language?: string | null; timeZone?: string | null };
  }): Record<string, unknown> {
    return {
      routineId: params.routineId,
      creatorUserId: params.userId,
      creationChannelId: params.channelId,
      isCreationChannel: true,
      ...(params.locale.language ? { language: params.locale.language } : {}),
      ...(params.locale.timeZone ? { timeZone: params.locale.timeZone } : {}),
    };
  }

  private buildRoutineCreationComponentConfigs(params: {
    routineId: string;
    tenantId: string;
    routineFolderId: string;
    team9Context: Record<string, unknown>;
  }): Record<string, Record<string, unknown>> {
    return {
      'team9-routine-creation': {
        routineId: params.routineId,
        isCreationChannel: true,
        team9Context: params.team9Context,
      },
      'just-bash-team9-workspace': {
        folderMap: {
          'routine.document': {
            workspaceId: params.tenantId,
            folderId: params.routineFolderId,
            folderType: 'managed',
            permission: 'write',
            readOnly: false,
          },
        },
        mountTeam9Skills: true,
      },
    };
  }

  private extractAgentIdFromCreationSessionId(
    sessionId: string,
  ): string | null {
    const parts = sessionId.split('/');
    if (parts[0] !== 'team9' || parts.length < 5) return null;
    return parts[2] || null;
  }

  private needsRoutineCreationSessionRepair(
    session: HiveSessionDetail | null,
    routineId: string,
  ): boolean {
    if (!session) return true;

    const sessionContext = session.team9Context as
      | Record<string, unknown>
      | undefined;
    const hasSessionContext = sessionContext?.routineId === routineId;

    const componentConfigs = session.componentConfigs as
      | Record<string, Record<string, unknown>>
      | undefined;
    const routineConfig = componentConfigs?.['team9-routine-creation'];
    const routineConfigContext = routineConfig?.team9Context as
      | Record<string, unknown>
      | undefined;
    const hasRoutineComponentContext =
      routineConfig?.routineId === routineId &&
      routineConfigContext?.routineId === routineId;

    return !hasSessionContext || !hasRoutineComponentContext;
  }

  private async repairRoutineCreationHiveSessionIfNeeded(params: {
    routineId: string;
    userId: string;
    tenantId: string;
    channelId: string;
    sessionId: string;
  }): Promise<void> {
    const session = await this.clawHiveService.getSession(
      params.sessionId,
      params.tenantId,
    );
    if (!this.needsRoutineCreationSessionRepair(session, params.routineId)) {
      return;
    }

    const agentId = this.extractAgentIdFromCreationSessionId(params.sessionId);
    if (!agentId) {
      throw new BadRequestException(
        'Creation session id is malformed; cannot repair Hive session context',
      );
    }

    const locale = await this.usersService.getLocalePreferences(params.userId);
    const team9Context = this.buildRoutineCreationTeam9Context({
      routineId: params.routineId,
      userId: params.userId,
      channelId: params.channelId,
      locale,
    });
    const ensured = await ensureRoutineFolder(params.routineId, {
      db: this.db,
      provisionDeps: {
        folder9Client: this.folder9Client,
        workspaceId: params.tenantId,
        psk: '',
      },
    });
    const routineFolderId = ensured.folderId!;

    await this.clawHiveService.createSession(
      agentId,
      {
        userId: params.userId,
        sessionId: params.sessionId,
        team9Context,
        componentConfigs: this.buildRoutineCreationComponentConfigs({
          routineId: params.routineId,
          tenantId: params.tenantId,
          routineFolderId,
          team9Context,
        }),
      },
      params.tenantId,
    );
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
        await this.repairRoutineCreationHiveSessionIfNeeded({
          routineId,
          userId,
          tenantId,
          channelId: routine.creationChannelId,
          sessionId: routine.creationSessionId,
        });
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

    // documentContent is no longer enriched onto the kickoff payload — the
    // routine→folder9 skill migration moved runbook body content to a
    // managed folder9 SKILL.md, and the agent now reads it via the
    // filesystem-backed mount at `/workspace/routine/document/SKILL.md`.
    // Carrying the deprecated legacy column on the kickoff event misled the
    // agent into "documentContent is empty therefore SKILL.md is missing"
    // loops when the actual source of truth lives in folder9.

    // Fetch existing triggers as best-effort enrichment so the agent can
    // render an accurate state (e.g. "1 trigger configured") instead of
    // showing "0 configured" for drafts that already have triggers.
    // Use a direct tenant-scoped DB select rather than routineTriggersService
    // to avoid a redundant getRoutineOrThrow inside listByRoutine (we already
    // validated the routine above). routineTriggers has no tenantId column, so
    // we scope via the validated routineId FK only.
    let draftTriggers: unknown[] = [];
    try {
      draftTriggers = await this.db
        .select()
        .from(schema.routineTriggers)
        .where(eq(schema.routineTriggers.routineId, routineId));
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

      const locale = await this.usersService.getLocalePreferences(userId);
      const team9Context = this.buildRoutineCreationTeam9Context({
        routineId,
        userId,
        channelId: channel.id,
        locale,
      });

      // ── Routine folder intent for JustBashTeam9WorkspaceComponent ───
      //
      // The routine-creation agent authors `SKILL.md` (and optional
      // `references/`, `scripts/`) into the routine's folder9 folder
      // mounted at `/workspace/routine/document`. The mount is
      // described as a **static intent** here (workspaceId + folderId
      // + folderType + permission) — no token is pre-minted. The
      // agent-pi `JustBashTeam9WorkspaceComponent` calls
      // `Team9FolderTokenApi.issueFolderToken` at `onSessionStart`,
      // which maps to `POST /api/v1/bot/folder-token` on this gateway.
      // Dynamic issuance gives the server full session context
      // (sessionId, agentId, routineId, userId, logicalKey) at
      // authorization time, keeps tokens out of persisted session
      // configs, and sidesteps TTL alignment with session-creation
      // wall time.
      //
      // `ensureRoutineFolder` is idempotent: if the routine already
      // has a `folderId` (most v2+ rows), it short-circuits via the
      // SELECT ... FOR UPDATE fast path; if it's still NULL (legacy
      // row pre-A.1, or a brand-new draft whose creation provision
      // failed and was retried), it lazily provisions a managed
      // folder + scaffolds SKILL.md inside its own transaction and
      // back-fills `folder_id`. Either way, on return the row has a
      // non-null `folderId`. Failure surfaces as a 503 from the
      // helper itself; we let it propagate so the outer catch-block
      // rolls back the channel + claim.
      const ensured = await ensureRoutineFolder(routineId, {
        db: this.db,
        provisionDeps: {
          folder9Client: this.folder9Client,
          workspaceId: tenantId,
          psk: '',
        },
      });
      const routineFolderId = ensured.folderId!;

      const componentConfigs = this.buildRoutineCreationComponentConfigs({
        routineId,
        tenantId,
        routineFolderId,
        team9Context,
      });

      await this.clawHiveService.createSession(
        agentId,
        { userId, sessionId, team9Context, componentConfigs },
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

  // ── Folder proxy (tree / blob / commit / history) ──────────────
  //
  // Every method below follows the same template:
  //   1. `ensureRoutineFolder(routineId)` — guarantees `folderId` is
  //      non-null. Lazy-provisions on first access; subsequent calls
  //      hit the SELECT-FOR-UPDATE fast path (~one round-trip).
  //   2. Tenant gate: `currentUser.tenantId === routine.tenantId` else
  //      403. Cross-tenant access is treated as a permission error,
  //      not a 404 — we already proved the routine exists at step 1
  //      and disclosing existence to a wrong-tenant caller is fine
  //      because the routine id is itself unguessable (UUIDv7).
  //   3. Mint a per-request, short-lived folder9 token. We deliberately
  //      do NOT cache tokens (unlike WikisService) — read endpoints
  //      get a 5-min token, write/propose endpoints get a 15-min token.
  //      Per-request mints are simpler (no cache-invalidation surprises
  //      across review-mode flips, no leak window when a user loses
  //      access mid-session) and the upstream cost is negligible for
  //      the routine surface (one folder per routine, low fan-out).
  //   4. Forward to the folder9 client; return its response unchanged.
  //
  // Commit specifically computes the `propose` flag from `(folder
  // approval_mode, user permission)` per spec §12. v1 routines are
  // always `approval_mode: "auto"`, so propose is always false; the
  // wiring is structural so flipping a routine to review mode later
  // activates the propose path with no code changes.

  /**
   * Read-token TTL for routine folder reads. 5 minutes — enough to
   * cover a single proxied request comfortably while capping the leak
   * window if a token surfaces in a log scrape.
   */
  private static readonly READ_TOKEN_TTL_MS = 5 * 60_000;

  /**
   * Write-token TTL for routine folder writes. 15 minutes — matches
   * the wiki cache TTL and the existing A.2 provision pattern. Long
   * enough for a multi-file commit to retry after a transient blip;
   * still bounded.
   */
  private static readonly WRITE_TOKEN_TTL_MS = 15 * 60_000;

  /**
   * Resolve a routine + ensure folder + tenant gate, returning the
   * routine row with non-null `folderId`.
   *
   * The routine row read is the one returned from `ensureRoutineFolder`
   * (which already SELECT-FOR-UPDATEs and updates the row inside its
   * own transaction). No second SELECT.
   */
  private async resolveRoutineForFolderProxy(
    routineId: string,
    tenantId: string,
  ): Promise<{ folderId: string; tenantId: string }> {
    const ensured = await ensureRoutineFolder(routineId, {
      db: this.db,
      provisionDeps: {
        folder9Client: this.folder9Client,
        // Use the FETCHED routine's tenantId (not the request param)
        // so a misconfigured client can't request a folder under the
        // wrong workspace. We still cross-check below — defence in
        // depth.
        workspaceId: tenantId,
        psk: '',
      },
    });
    if (ensured.tenantId !== tenantId) {
      throw new ForbiddenException(
        'You do not have access to this routine folder',
      );
    }
    // `ensureRoutineFolder` guarantees folderId is non-null; the cast
    // here documents the invariant for the type system. If this ever
    // throws at runtime, the invariant has been broken upstream.
    if (!ensured.folderId) {
      // NOCOVER: ensureRoutineFolder's invariant says this is unreachable.
      throw new ServiceUnavailableException('routine folder not provisioned');
    }
    return { folderId: ensured.folderId, tenantId: ensured.tenantId };
  }

  /**
   * Mint a per-request folder9 token for a routine folder.
   *
   * Tokens are scoped to (folder, permission, expiry). `name` and
   * `created_by` are descriptive — folder9 surfaces them in audit logs
   * and (for writes) uses `created_by` as the git commit author tag.
   */
  private async mintRoutineFolderToken(
    folderId: string,
    routineId: string,
    userId: string,
    permission: Folder9Permission,
    ttlMs: number,
  ): Promise<string> {
    const minted = await this.folder9Client.createToken({
      folder_id: folderId,
      permission,
      name: `routine-${permission}`,
      created_by: `user:${userId}`,
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
    });
    this.logger.debug(
      `mintRoutineFolderToken: routine=${routineId} folder=${folderId} permission=${permission} ttlMs=${ttlMs}`,
    );
    return minted.token;
  }

  /**
   * Resolve the user's permission on a routine folder.
   *
   * v1 model: routines are workspace-shared and every tenant member has
   * direct-write permission. The signature still returns the discriminated
   * union (`'write' | 'propose'`) so the call site at
   * {@link commitRoutineFolder} keeps the propose branch live in the
   * type system. When a future RBAC layer differentiates "must propose"
   * users (e.g. agents) from "may write" users (e.g. owners), this body
   * becomes a per-user lookup and the propose pipeline activates without
   * touching the controller, the DTO, or the proxy.
   *
   * @param _userId reserved for the future RBAC lookup; intentionally
   *   unused in v1 so we don't have to mock a user-roles table.
   * @param _routineId same — reserved for per-routine policy.
   */
  private getRoutineFolderPermissionForUser(
    _userId: string,
    _routineId: string,
  ): 'write' | 'propose' {
    return 'write';
  }

  /**
   * GET /v1/routines/:id/folder/tree — list files under the routine
   * folder.
   */
  async getRoutineFolderTree(
    routineId: string,
    userId: string,
    tenantId: string,
    opts: { path?: string; recursive?: boolean } = {},
  ): Promise<Folder9TreeEntry[]> {
    const { folderId, tenantId: routineTenantId } =
      await this.resolveRoutineForFolderProxy(routineId, tenantId);
    const token = await this.mintRoutineFolderToken(
      folderId,
      routineId,
      userId,
      'read',
      RoutinesService.READ_TOKEN_TTL_MS,
    );
    return this.folder9Client.getTree(routineTenantId, folderId, token, {
      path: opts.path,
      recursive: opts.recursive,
    });
  }

  /**
   * GET /v1/routines/:id/folder/blob — read a single file from the
   * routine folder. Pass-through of folder9's `Folder9BlobResponse`
   * (which carries the `encoding` discriminator); decoding is the
   * client's responsibility.
   */
  async getRoutineFolderBlob(
    routineId: string,
    userId: string,
    tenantId: string,
    path: string,
  ): Promise<Folder9BlobResponse> {
    if (!path || typeof path !== 'string' || path.trim().length === 0) {
      throw new BadRequestException('path query parameter is required');
    }
    const { folderId, tenantId: routineTenantId } =
      await this.resolveRoutineForFolderProxy(routineId, tenantId);
    const token = await this.mintRoutineFolderToken(
      folderId,
      routineId,
      userId,
      'read',
      RoutinesService.READ_TOKEN_TTL_MS,
    );
    return this.folder9Client.getBlob(routineTenantId, folderId, token, path);
  }

  /**
   * POST /v1/routines/:id/folder/commit — write a batch of file changes.
   *
   * Permission decision:
   *
   *   | folder.approval_mode | user permission | effective propose |
   *   |----------------------|-----------------|-------------------|
   *   | auto                 | write           | false             |
   *   | review               | write           | false             |
   *   | review               | propose         | true              |
   *
   * v1 routines are always `auto`; the resulting commit goes straight
   * to `main`. The structure is wired so a future PATCH that flips a
   * routine's folder to `approval_mode: "review"` (paired with a
   * permission downgrade for non-admin members) automatically routes
   * through the proposal branch with no further code changes.
   *
   * The user permission is currently always `write` for tenant
   * members — routines are workspace-shared in v1. That's encoded
   * here as the constant; when a future RBAC layer differentiates
   * write-vs-propose for routine folders, this is the line to swap.
   */
  async commitRoutineFolder(
    routineId: string,
    userId: string,
    tenantId: string,
    dto: FolderCommitDto,
  ): Promise<Folder9CommitResponse> {
    const { folderId, tenantId: routineTenantId } =
      await this.resolveRoutineForFolderProxy(routineId, tenantId);

    // Fetch the live folder to read `approval_mode`. v1 always returns
    // "auto", but we MUST NOT hard-code that — an operator flipping the
    // folder to "review" via a future routine-settings UI would
    // silently bypass review if we did. The folder9 round-trip is
    // ~10ms and only fires on commits (not every read).
    const folder = await this.folder9Client.getFolder(
      routineTenantId,
      folderId,
    );

    // Tenant members are write-permission users on routine folders in
    // v1. When a future scenario requires "agent must propose, human
    // must approve", swap this method's body for a per-user RBAC lookup
    // and the rest of the propose pipeline activates with no further
    // changes. Encapsulated as a method (not a `const` literal) so the
    // typechecker doesn't narrow it to `"write"` and dead-code the
    // propose branch.
    const userPermission = this.getRoutineFolderPermissionForUser(
      userId,
      routineId,
    );

    // Compute effective propose flag. `auto` always direct-commits.
    // `review` + `write` is "write bypasses review" — matches the
    // wiki contract. `review` + `propose` lands on a proposal branch.
    const effectivePropose =
      folder.approval_mode === 'review' && userPermission === 'propose';

    const tokenPermission: Folder9Permission = effectivePropose
      ? 'propose'
      : 'write';
    const token = await this.mintRoutineFolderToken(
      folderId,
      routineId,
      userId,
      tokenPermission,
      RoutinesService.WRITE_TOKEN_TTL_MS,
    );

    return this.folder9Client.commit(routineTenantId, folderId, token, {
      message: dto.message,
      files: dto.files,
      propose: effectivePropose,
    });
  }

  /**
   * GET /v1/routines/:id/folder/history — list commits on the
   * routine's main branch (or a specific ref / path).
   *
   * Returns folder9's `Folder9LogEntry[]` shape verbatim (PascalCase
   * field names — the wire format is owned by folder9, not us).
   */
  async getRoutineFolderHistory(
    routineId: string,
    userId: string,
    tenantId: string,
    opts: { ref?: string; path?: string; limit?: number } = {},
  ): Promise<Folder9LogEntry[]> {
    const { folderId, tenantId: routineTenantId } =
      await this.resolveRoutineForFolderProxy(routineId, tenantId);
    const token = await this.mintRoutineFolderToken(
      folderId,
      routineId,
      userId,
      'read',
      RoutinesService.READ_TOKEN_TTL_MS,
    );
    return this.folder9Client.log(routineTenantId, folderId, token, opts);
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
