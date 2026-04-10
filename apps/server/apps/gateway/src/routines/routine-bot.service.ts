import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  sql,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { WS_EVENTS } from '@team9/shared';
import { WEBSOCKET_GATEWAY } from '../shared/constants/injection-tokens.js';
import type { WebsocketGateway } from '../im/websocket/websocket.gateway.js';
import type { ReportStepsDto } from './dto/report-steps.dto.js';
import type { CreateInterventionDto } from './dto/create-intervention.dto.js';
import type { UpdateRoutineDto } from './dto/update-routine.dto.js';
import { TaskCastService } from './taskcast.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { RoutineTriggersService } from './routine-triggers.service.js';

// ── Service ─────────────────────────────────────────────────────────

@Injectable()
export class RoutineBotService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(WEBSOCKET_GATEWAY)
    private readonly wsGateway: WebsocketGateway,
    private readonly taskCastService: TaskCastService,
    private readonly documentsService: DocumentsService,
    private readonly routineTriggersService: RoutineTriggersService,
  ) {}

  // ── Report step progress ─────────────────────────────────────────

  async reportSteps(
    routineId: string,
    executionId: string,
    botUserId: string,
    dto: ReportStepsDto,
  ) {
    const { execution } = await this.getExecutionDirect(
      routineId,
      executionId,
      botUserId,
    );

    for (const step of dto.steps) {
      // Check if a step already exists for this execution + orderIndex
      const [existing] = await this.db
        .select()
        .from(schema.routineSteps)
        .where(
          and(
            eq(schema.routineSteps.executionId, execution.id),
            eq(schema.routineSteps.orderIndex, step.orderIndex),
          ),
        )
        .limit(1);

      if (existing) {
        // Update existing step
        const updateData: Record<string, unknown> = {
          title: step.title,
          status: step.status,
        };

        if (step.tokenUsage !== undefined) {
          updateData.tokenUsage = step.tokenUsage;
        }
        if (step.duration !== undefined) {
          updateData.duration = step.duration;
        }

        if (step.status === 'in_progress' && !existing.startedAt) {
          updateData.startedAt = new Date();
        }
        if (step.status === 'completed' || step.status === 'failed') {
          updateData.completedAt = new Date();
        }

        await this.db
          .update(schema.routineSteps)
          .set(updateData)
          .where(eq(schema.routineSteps.id, existing.id));
      } else {
        // Create new step
        const now = new Date();
        await this.db.insert(schema.routineSteps).values({
          id: uuidv7(),
          executionId: execution.id,
          routineId,
          orderIndex: step.orderIndex,
          title: step.title,
          status: step.status,
          tokenUsage: step.tokenUsage ?? 0,
          duration: step.duration ?? null,
          startedAt: step.status === 'in_progress' ? now : null,
          completedAt:
            step.status === 'completed' || step.status === 'failed'
              ? now
              : null,
        });
      }
    }

    // Sum all step token usage and update execution total
    const [result] = await this.db
      .select({
        total: sql<number>`COALESCE(SUM(${schema.routineSteps.tokenUsage}), 0)::integer`,
      })
      .from(schema.routineSteps)
      .where(eq(schema.routineSteps.executionId, execution.id));

    await this.db
      .update(schema.routineExecutions)
      .set({ tokenUsage: result.total })
      .where(eq(schema.routineExecutions.id, execution.id));

    // Return updated steps
    const steps = await this.db
      .select()
      .from(schema.routineSteps)
      .where(eq(schema.routineSteps.executionId, execution.id))
      .orderBy(schema.routineSteps.orderIndex);

    // Publish step progress to TaskCast
    if (execution.taskcastTaskId) {
      await this.taskCastService.publishEvent(execution.taskcastTaskId, {
        type: 'step',
        data: { steps },
        seriesId: 'steps',
        seriesMode: 'latest',
      });
    }

    return steps;
  }

  // ── Update execution status ──────────────────────────────────────

  async updateStatus(
    routineId: string,
    executionId: string,
    botUserId: string,
    status: string,
    error?: { code?: string; message: string },
  ) {
    const { routine, execution } = await this.getExecutionDirect(
      routineId,
      executionId,
      botUserId,
    );

    const validTerminalStatuses = ['completed', 'failed', 'timeout'];
    if (!validTerminalStatuses.includes(status)) {
      throw new BadRequestException(
        `Invalid status '${status}'. Must be one of: ${validTerminalStatuses.join(', ')}`,
      );
    }

    const now = new Date();

    // Update execution
    const executionUpdate: Record<string, unknown> = {
      status,
      completedAt: now,
    };

    if (execution.startedAt) {
      executionUpdate.duration = Math.round(
        (now.getTime() - execution.startedAt.getTime()) / 1000,
      );
    }

    if (error) {
      executionUpdate.error = error;
    }

    const [updatedExecution] = await this.db
      .update(schema.routineExecutions)
      .set(executionUpdate)
      .where(eq(schema.routineExecutions.id, execution.id))
      .returning();

    // Update routine status
    const [updatedRoutine] = await this.db
      .update(schema.routines)
      .set({
        status: status as schema.RoutineStatus,
        updatedAt: now,
      })
      .where(eq(schema.routines.id, routineId))
      .returning();

    // Emit WebSocket event to workspace
    await this.wsGateway.broadcastToWorkspace(
      routine.tenantId,
      WS_EVENTS.ROUTINE.STATUS_CHANGED,
      {
        routineId,
        executionId: execution.id,
        status,
        previousStatus: routine.status,
      },
    );

    // Sync status to TaskCast
    if (execution.taskcastTaskId) {
      await this.taskCastService.transitionStatus(
        execution.taskcastTaskId,
        status,
      );
    }

    return { routine: updatedRoutine, execution: updatedExecution };
  }

  // ── Create intervention ──────────────────────────────────────────

  async createIntervention(
    routineId: string,
    executionId: string,
    botUserId: string,
    dto: CreateInterventionDto,
  ) {
    const { routine, execution } = await this.getExecutionDirect(
      routineId,
      executionId,
      botUserId,
    );

    const interventionId = uuidv7();

    const [intervention] = await this.db
      .insert(schema.routineInterventions)
      .values({
        id: interventionId,
        executionId: execution.id,
        routineId,
        stepId: dto.stepId ?? null,
        prompt: dto.prompt,
        actions: dto.actions,
      })
      .returning();

    // Set routine status to pending_action
    await this.db
      .update(schema.routines)
      .set({
        status: 'pending_action',
        updatedAt: new Date(),
      })
      .where(eq(schema.routines.id, routineId));

    // Emit WebSocket event
    await this.wsGateway.broadcastToWorkspace(
      routine.tenantId,
      WS_EVENTS.ROUTINE.STATUS_CHANGED,
      {
        routineId,
        executionId: execution.id,
        status: 'pending_action',
        previousStatus: routine.status,
      },
    );

    // Sync blocked status + intervention event to TaskCast
    if (execution.taskcastTaskId) {
      await this.taskCastService.transitionStatus(
        execution.taskcastTaskId,
        'pending_action',
      );
      await this.taskCastService.publishEvent(execution.taskcastTaskId, {
        type: 'intervention',
        data: { intervention },
        seriesId: `intervention:${intervention.id}`,
        seriesMode: 'latest',
      });
    }

    return intervention;
  }

  // ── Add deliverable ──────────────────────────────────────────────

  async addDeliverable(
    routineId: string,
    executionId: string,
    botUserId: string,
    data: {
      fileName: string;
      fileSize?: number;
      mimeType?: string;
      fileUrl: string;
    },
  ) {
    const { execution } = await this.getExecutionDirect(
      routineId,
      executionId,
      botUserId,
    );

    const deliverableId = uuidv7();

    const [deliverable] = await this.db
      .insert(schema.routineDeliverables)
      .values({
        id: deliverableId,
        executionId: execution.id,
        routineId,
        fileName: data.fileName,
        fileSize: data.fileSize ?? null,
        mimeType: data.mimeType ?? null,
        fileUrl: data.fileUrl,
      })
      .returning();

    // Publish deliverable event to TaskCast
    if (execution.taskcastTaskId) {
      await this.taskCastService.publishEvent(execution.taskcastTaskId, {
        type: 'deliverable',
        data: { deliverable },
      });
    }

    return deliverable;
  }

  // ── Get routine document ────────────────────────────────────────────

  async getRoutineDocument(
    routineId: string,
    executionId: string,
    botUserId: string,
  ) {
    const { routine } = await this.getExecutionReadOnly(
      routineId,
      executionId,
      botUserId,
    );

    if (!routine.documentId) {
      return null;
    }

    const [document] = await this.db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, routine.documentId))
      .limit(1);

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    let currentVersion: {
      id: string;
      versionIndex: number;
      content: string;
      summary: string | null;
      createdAt: Date;
    } | null = null;

    if (document.currentVersionId) {
      const [ver] = await this.db
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.id, document.currentVersionId))
        .limit(1);

      if (ver) {
        currentVersion = {
          id: ver.id,
          versionIndex: ver.versionIndex,
          content: ver.content,
          summary: ver.summary,
          createdAt: ver.createdAt,
        };
      }
    }

    return {
      id: document.id,
      title: document.title,
      documentType: document.documentType,
      currentVersion,
    };
  }

  // ── Routine CRUD (bot-scoped) ─────────────────────────────────────

  /**
   * Create a routine on behalf of the human user linked to this bot.
   * The bot token identifies the bot; we derive the human creatorId from
   * the bot's mentorId (personal staff) or ownerId.
   */
  async createRoutine(
    dto: { title: string; documentContent?: string; description?: string; botId?: string; triggers?: Array<{ type: string; config: Record<string, unknown>; enabled?: boolean }> },
    botUserId: string,
    tenantId: string,
  ) {
    // Resolve bot record from shadow userId
    const [bot] = await this.db
      .select()
      .from(schema.bots)
      .where(eq(schema.bots.userId, botUserId))
      .limit(1);

    if (!bot) {
      throw new NotFoundException('Bot not found for this user');
    }

    // Use mentorId (personal staff) or ownerId as the human creator
    const creatorId = bot.mentorId ?? bot.ownerId;
    if (!creatorId) {
      throw new BadRequestException('Bot has no associated human user (no mentorId or ownerId)');
    }

    // Validate explicit botId belongs to this tenant if provided
    const botId = dto.botId ?? bot.id;
    if (dto.botId && dto.botId !== bot.id) {
      const [targetBot] = await this.db
        .select({ id: schema.bots.id })
        .from(schema.bots)
        .leftJoin(
          schema.installedApplications,
          eq(schema.bots.installedApplicationId, schema.installedApplications.id),
        )
        .where(
          and(
            eq(schema.bots.id, dto.botId),
            eq(schema.installedApplications.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (!targetBot) {
        throw new BadRequestException('Specified botId does not belong to the current tenant');
      }
    }

    const routineId = uuidv7();
    const doc = await this.documentsService.create(
      {
        documentType: 'task',
        content: dto.documentContent ?? '',
        title: dto.title,
      },
      { type: 'user', id: creatorId },
      tenantId,
    );

    const insertValues: schema.NewRoutine = {
      id: routineId,
      tenantId,
      botId,
      creatorId,
      title: dto.title,
      description: dto.description ?? null,
      scheduleType: 'once',
      scheduleConfig: null,
      documentId: doc.id,
    };
    (insertValues as Record<string, unknown>).status = 'draft';

    const [routine] = await this.db
      .insert(schema.routines)
      .values(insertValues)
      .returning();

    return routine;
  }

  /**
   * Fetch a routine by ID, verifying the calling bot is the assigned bot.
   * Returns routine enriched with documentContent and triggers.
   */
  async getRoutineById(
    routineId: string,
    botUserId: string,
    tenantId: string,
  ) {
    const routine = await this.getRoutineOrThrow(routineId, tenantId);

    // Verify calling bot is the assigned bot
    if (routine.botId) {
      await this.verifyBotOwnership(routine.botId, botUserId);
    }

    // Enrich with document content
    let documentContent = '';
    if (routine.documentId) {
      try {
        const doc = await this.documentsService.getById(routine.documentId);
        documentContent = (doc as { content?: string | null }).content ?? '';
      } catch {
        documentContent = '';
      }
    }

    // Enrich with triggers
    const triggers = await this.routineTriggersService.listByRoutine(routineId, tenantId);

    return { ...routine, documentContent, triggers };
  }

  /**
   * Partially update a routine, verifying the calling bot is the assigned bot.
   * Uses routine.creatorId for ownership check in the underlying service logic.
   */
  async updateRoutine(
    routineId: string,
    dto: UpdateRoutineDto,
    botUserId: string,
    tenantId: string,
  ) {
    const routine = await this.getRoutineOrThrow(routineId, tenantId);

    // Verify calling bot is the assigned bot
    if (routine.botId) {
      await this.verifyBotOwnership(routine.botId, botUserId);
    }

    // Reject status transitions — same guard as RoutinesService.update
    if (dto.status !== undefined && dto.status !== routine.status) {
      throw new BadRequestException(
        `Cannot change routine status from '${routine.status}' to '${dto.status}' via update. Use the appropriate control endpoint.`,
      );
    }

    // Handle documentContent
    if (dto.documentContent !== undefined) {
      if (!routine.documentId) {
        throw new BadRequestException('Cannot update document content: routine has no linked document.');
      }
      await this.documentsService.update(
        routine.documentId,
        { content: dto.documentContent },
        { type: 'user', id: routine.creatorId },
      );
    }

    // Handle triggers — wholesale replace
    if (dto.triggers !== undefined) {
      await this.routineTriggersService.replaceAllForRoutine(routineId, dto.triggers, tenantId);
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.botId !== undefined) updateData.botId = dto.botId;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.scheduleType !== undefined) updateData.scheduleType = dto.scheduleType;
    if (dto.scheduleConfig !== undefined) updateData.scheduleConfig = dto.scheduleConfig;

    const [updated] = await this.db
      .update(schema.routines)
      .set(updateData)
      .where(eq(schema.routines.id, routineId))
      .returning();

    return updated;
  }

  // ── Private helpers ──────────────────────────────────────────────

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

  private async verifyBotOwnership(botId: string, botUserId: string) {
    const [bot] = await this.db
      .select({ userId: schema.bots.userId })
      .from(schema.bots)
      .where(eq(schema.bots.id, botId))
      .limit(1);

    if (!bot || bot.userId !== botUserId) {
      throw new ForbiddenException('Bot does not own this routine');
    }
  }

  private async getExecutionDirect(
    routineId: string,
    executionId: string,
    botUserId?: string,
  ) {
    // 1. Direct lookup by executionId + routineId
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
      throw new NotFoundException('Execution not found for this routine');
    }

    // 2. Reject writes to terminal executions
    const terminalStatuses = ['completed', 'failed', 'timeout', 'stopped'];
    if (terminalStatuses.includes(execution.status)) {
      throw new ConflictException(
        `Cannot write to execution in terminal status: ${execution.status}`,
      );
    }

    // 3. Load routine
    const [routine] = await this.db
      .select()
      .from(schema.routines)
      .where(eq(schema.routines.id, routineId))
      .limit(1);

    if (!routine) {
      throw new NotFoundException('Routine not found');
    }

    // 4. Verify bot ownership
    if (botUserId && routine.botId) {
      await this.verifyBotOwnership(routine.botId, botUserId);
    }

    return { routine, execution };
  }

  private async getExecutionReadOnly(
    routineId: string,
    executionId: string,
    botUserId?: string,
  ) {
    // Same as getExecutionDirect but without terminal status rejection
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
      throw new NotFoundException('Execution not found for this routine');
    }

    const [routine] = await this.db
      .select()
      .from(schema.routines)
      .where(eq(schema.routines.id, routineId))
      .limit(1);

    if (!routine) {
      throw new NotFoundException('Routine not found');
    }

    if (botUserId && routine.botId) {
      await this.verifyBotOwnership(routine.botId, botUserId);
    }

    return { routine, execution };
  }
}
