import { Inject, Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  notInArray,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type {
  ExecutionContext,
  ExecutionStrategy,
} from './execution-strategy.interface.js';
import { TaskCastClient } from '../taskcast/taskcast.client.js';
import { Folder9Client } from '../folder9/folder9.client.js';
import { ensureRoutineFolder } from '../folder9/ensure-routine-folder.js';

/**
 * Read-token TTL for the folder9 token attached to ExecutionContext.
 *
 * Sized to comfortably exceed the expected execution wall-clock duration
 * (~6 hours): the agent reads SKILL.md from the folder on session start
 * and may re-read on long-running tasks, but never holds the token past
 * end-of-execution. Matches the value documented in the routine→skill
 * folder spec §"Backend Contract — team9 Server Changes".
 */
const FOLDER9_READ_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class ExecutorService {
  private readonly logger = new Logger(ExecutorService.name);
  private readonly strategies = new Map<string, ExecutionStrategy>();

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly taskCastClient: TaskCastClient,
    private readonly folder9Client: Folder9Client,
  ) {}

  /**
   * Register an execution strategy for a given bot type.
   */
  registerStrategy(botType: string, strategy: ExecutionStrategy): void {
    this.strategies.set(botType, strategy);
    this.logger.log(`Registered execution strategy for bot type: ${botType}`);
  }

  /**
   * Trigger a full execution lifecycle for the given routine.
   *
   * 1. CAS: claim the routine atomically (must be first — prevents duplicate executions)
   * 2. Create task channel (type='task')
   * 3. Fetch document content (if linked)
   * 4. Create execution record in DB (with routine version snapshot)
   * 5. Update routine with currentExecutionId
   * 6. Look up bot's shadow userId from bots table
   * 7. Delegate to strategy
   * 8. Log completion
   */
  async triggerExecution(
    routineId: string,
    opts?: {
      triggerId?: string;
      triggerType?: string;
      triggerContext?: Record<string, unknown>;
      sourceExecutionId?: string;
      documentVersionId?: string;
    },
  ): Promise<void> {
    // ── 1. CAS: claim the routine atomically (must be first — prevents duplicate executions) ──
    const claimed = await this.db
      .update(schema.routines)
      .set({ status: 'in_progress', updatedAt: new Date() })
      .where(
        and(
          eq(schema.routines.id, routineId),
          notInArray(schema.routines.status, [
            'in_progress',
            'paused',
            'pending_action',
          ]),
        ),
      )
      .returning({
        id: schema.routines.id,
        botId: schema.routines.botId,
        tenantId: schema.routines.tenantId,
        documentId: schema.routines.documentId,
        creatorId: schema.routines.creatorId,
        title: schema.routines.title,
        version: schema.routines.version,
      });

    if (claimed.length === 0) {
      this.logger.warn(
        `Routine ${routineId} cannot start execution — status not eligible or already active`,
      );
      return;
    }

    const routine = claimed[0];
    this.logger.log(
      `Starting execution for routine ${routineId} ("${routine.title}")`,
    );

    if (!routine.botId) {
      this.logger.error(
        `Routine ${routineId} has no bot assigned, cannot execute`,
      );
      // Release CAS — mark as failed so it can be retried
      await this.db
        .update(schema.routines)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(schema.routines.id, routineId));
      return;
    }

    // ── 2. Create task channel (type='task') ──────────────────────────
    const channelId = uuidv7();
    await this.db.insert(schema.channels).values({
      id: channelId,
      tenantId: routine.tenantId,
      name: `task-${routine.title.slice(0, 60).replace(/\s+/g, '-').toLowerCase()}-${channelId.slice(-6)}`,
      type: 'task',
      createdBy: routine.creatorId,
    });

    // Add the routine creator as a channel member
    await this.db.insert(schema.channelMembers).values({
      id: uuidv7(),
      channelId,
      userId: routine.creatorId,
      role: 'owner',
    });

    // ── 3. Ensure routine folder + mint read token ────────────────────
    //
    // Replaces the legacy `documents` / `document_versions` fetch. After
    // the A.1–A.6 migration, routine instructions live in folder9 as
    // SKILL.md inside a managed folder; the agent reads it via the read
    // token we mint here. `ensureRoutineFolder` is the lazy-provision
    // invariant — after it returns, `routine.folderId` is non-null.
    //
    // The earlier `documentVersionId` plumbing is now legacy: callers
    // (scheduler / channel-trigger) don't pass it on the new path. We
    // honour `opts.documentVersionId` if present for backward
    // compatibility but no longer derive one from the routine itself.
    let folderId: string;
    let folder9Token: string;
    try {
      const ensured = await ensureRoutineFolder(routineId, {
        db: this.db,
        provisionDeps: {
          folder9Client: this.folder9Client,
          workspaceId: routine.tenantId,
          psk: '',
        },
      });
      // ensureRoutineFolder guarantees folderId is non-null on success.
      // The cast documents the invariant for the type system; an
      // unprovisioned row would have thrown above.
      folderId = ensured.folderId!;

      const minted = await this.folder9Client.createToken({
        folder_id: folderId,
        permission: 'read',
        name: 'routine-execute',
        created_by: `routine:${routineId}`,
        expires_at: new Date(
          Date.now() + FOLDER9_READ_TOKEN_TTL_MS,
        ).toISOString(),
      });
      folder9Token = minted.token;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to ensure folder / mint read token for routine ${routineId}: ${errorMessage}`,
      );
      // Mark the routine as failed so the run isn't left in_progress
      // forever. We don't have an executionId yet (it's minted below),
      // so the failure is recorded by reverting the CAS-claimed routine
      // status directly.
      await this.db
        .update(schema.routines)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(schema.routines.id, routineId));
      return;
    }

    let documentVersionId: string | undefined;
    if (opts?.documentVersionId) {
      documentVersionId = opts.documentVersionId;
    }

    // ── 4. Create execution record ────────────────────────────────────
    const executionId = uuidv7();
    const taskcastTaskId = await this.taskCastClient.createTask({
      routineId,
      executionId,
      botId: routine.botId,
      tenantId: routine.tenantId,
      ttl: 86400,
    });

    await this.db.insert(schema.routineExecutions).values({
      id: executionId,
      routineId,
      routineVersion: routine.version,
      status: 'in_progress',
      channelId,
      taskcastTaskId,
      triggerId: opts?.triggerId ?? null,
      triggerType: opts?.triggerType ?? null,
      triggerContext:
        (opts?.triggerContext as unknown as schema.TriggerContext) ?? null,
      documentVersionId: documentVersionId ?? null,
      sourceExecutionId: opts?.sourceExecutionId ?? null,
      startedAt: new Date(),
    });

    // ── 5. Update routine with currentExecutionId ────────────────────────
    await this.db
      .update(schema.routines)
      .set({ currentExecutionId: executionId })
      .where(eq(schema.routines.id, routineId));

    // ── 6. Look up bot's shadow userId ────────────────────────────────
    const [bot] = await this.db
      .select({
        userId: schema.bots.userId,
        type: schema.bots.type,
        managedProvider: schema.bots.managedProvider,
      })
      .from(schema.bots)
      .where(eq(schema.bots.id, routine.botId))
      .limit(1);

    if (!bot) {
      this.logger.error(`Bot not found: ${routine.botId}`);
      await this.markExecutionFailed(executionId, routineId, {
        code: 'BOT_NOT_FOUND',
        message: `Bot ${routine.botId} not found`,
      });
      return;
    }

    // Add the bot's shadow user to the task channel
    await this.db.insert(schema.channelMembers).values({
      id: uuidv7(),
      channelId,
      userId: bot.userId,
      role: 'member',
    });

    // ── 7. Delegate to strategy ───────────────────────────────────────
    const strategyKey = this.resolveStrategyKey(bot);
    const strategy = this.strategies.get(strategyKey);
    const context: ExecutionContext = {
      routineId,
      executionId,
      botId: routine.botId,
      channelId,
      title: routine.title,
      folderId,
      folder9Token,
      taskcastTaskId,
      tenantId: routine.tenantId,
    };

    if (strategy) {
      try {
        await strategy.execute(context);
        this.logger.log(
          `Execution ${executionId} delegated to ${strategyKey} strategy`,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;

        this.logger.error(
          `Strategy execution failed for routine ${routineId}: ${errorMessage}`,
          errorStack,
        );

        const now = new Date();
        await this.db
          .update(schema.routineExecutions)
          .set({
            status: 'failed',
            completedAt: now,
            error: { message: errorMessage, details: errorStack },
          })
          .where(eq(schema.routineExecutions.id, executionId));

        await this.db
          .update(schema.routines)
          .set({ status: 'failed', updatedAt: now })
          .where(eq(schema.routines.id, routineId));

        return;
      }
    } else {
      this.logger.error(`No strategy registered for bot type "${strategyKey}"`);
      await this.markExecutionFailed(executionId, routineId, {
        code: 'NO_STRATEGY',
        message: `No execution strategy registered for bot type "${strategyKey}"`,
      });
      return;
    }

    // ── 8. Log completion ──────────────────────────────────────────────
    this.logger.log(
      `Execution ${executionId} initiated for routine ${routineId}`,
    );
  }

  /**
   * Stop the currently active execution for the given routine.
   */
  async stopExecution(routineId: string): Promise<void> {
    // 1. Load routine
    const [routine] = await this.db
      .select({
        id: schema.routines.id,
        botId: schema.routines.botId,
        tenantId: schema.routines.tenantId,
        title: schema.routines.title,
        currentExecutionId: schema.routines.currentExecutionId,
      })
      .from(schema.routines)
      .where(eq(schema.routines.id, routineId))
      .limit(1);

    if (!routine) {
      this.logger.error(`Routine not found for stop: ${routineId}`);
      return;
    }

    if (!routine.currentExecutionId) {
      this.logger.warn(`Routine ${routineId} has no active execution to stop`);
      return;
    }

    if (!routine.botId) {
      this.logger.error(`Routine ${routineId} has no bot assigned`);
      return;
    }

    // 2. Load execution
    const [execution] = await this.db
      .select()
      .from(schema.routineExecutions)
      .where(eq(schema.routineExecutions.id, routine.currentExecutionId))
      .limit(1);

    if (!execution) {
      this.logger.error(`Execution ${routine.currentExecutionId} not found`);
      return;
    }

    // 3. Look up bot type → get strategy
    const [bot] = await this.db
      .select({
        type: schema.bots.type,
        managedProvider: schema.bots.managedProvider,
      })
      .from(schema.bots)
      .where(eq(schema.bots.id, routine.botId))
      .limit(1);

    if (!bot) {
      this.logger.error(`Bot not found: ${routine.botId}`);
      await this.markExecutionFailed(routine.currentExecutionId, routineId, {
        code: 'BOT_NOT_FOUND',
        message: `Bot ${routine.botId} not found`,
      });
      return;
    }

    const strategyKey = this.resolveStrategyKey(bot);
    const strategy = this.strategies.get(strategyKey);
    if (!strategy) {
      this.logger.error(`No strategy for bot type "${strategyKey}"`);
      return;
    }

    // 4. Call strategy.stop() (only if we have a valid channelId)
    if (!execution.channelId) {
      this.logger.warn(
        `Execution ${execution.id} for routine ${routineId} has no channelId; skipping strategy.stop`,
      );
    } else {
      const context: ExecutionContext = {
        routineId,
        executionId: execution.id,
        botId: routine.botId,
        channelId: execution.channelId,
        title: routine.title,
        taskcastTaskId: execution.taskcastTaskId,
        tenantId: routine.tenantId,
      };

      try {
        await strategy.stop(context);
      } catch (error) {
        this.logger.warn(
          `Strategy stop failed for routine ${routineId}: ${error}`,
        );
      }
    }

    // 5. Update execution + routine status to stopped
    const now = new Date();

    await this.db
      .update(schema.routineExecutions)
      .set({
        status: 'stopped',
        completedAt: now,
        ...(execution.startedAt
          ? {
              duration: Math.round(
                (now.getTime() - execution.startedAt.getTime()) / 1000,
              ),
            }
          : {}),
      })
      .where(eq(schema.routineExecutions.id, execution.id));

    await this.db
      .update(schema.routines)
      .set({
        status: 'stopped',
        updatedAt: now,
      })
      .where(eq(schema.routines.id, routineId));

    this.logger.log(
      `Execution ${execution.id} stopped for routine ${routineId}`,
    );
  }

  /**
   * Pause the currently active execution for the given task.
   *
   * Note: Uses read-then-check pattern (not CAS) for status validation.
   * Duplicate pause commands are harmless — interruptSession is idempotent
   * (404 swallowed by HiveStrategy) and DB writes are idempotent.
   */
  async pauseExecution(routineId: string): Promise<void> {
    const [routine] = await this.db
      .select({
        id: schema.routines.id,
        botId: schema.routines.botId,
        tenantId: schema.routines.tenantId,
        title: schema.routines.title,
        currentExecutionId: schema.routines.currentExecutionId,
        status: schema.routines.status,
      })
      .from(schema.routines)
      .where(eq(schema.routines.id, routineId))
      .limit(1);

    if (!routine) {
      this.logger.error(`Routine ${routineId} not found`);
      return;
    }

    if (!routine.currentExecutionId || !routine.botId) {
      this.logger.warn(
        `Routine ${routineId} cannot be paused — no active execution or bot`,
      );
      return;
    }

    if (routine.status !== 'in_progress') {
      this.logger.warn(
        `Routine ${routineId} cannot be paused — current status is ${routine.status}`,
      );
      return;
    }

    const [execution] = await this.db
      .select()
      .from(schema.routineExecutions)
      .where(eq(schema.routineExecutions.id, routine.currentExecutionId))
      .limit(1);

    if (!execution) {
      this.logger.error(`Execution ${routine.currentExecutionId} not found`);
      return;
    }

    const [bot] = await this.db
      .select({
        type: schema.bots.type,
        managedProvider: schema.bots.managedProvider,
      })
      .from(schema.bots)
      .where(eq(schema.bots.id, routine.botId))
      .limit(1);

    if (!bot) {
      this.logger.error(`Bot not found: ${routine.botId}`);
      return;
    }

    const strategyKey = this.resolveStrategyKey(bot);
    const strategy = this.strategies.get(strategyKey);
    if (!strategy) {
      this.logger.error(`No strategy for bot type "${strategyKey}"`);
      return;
    }

    if (!execution.channelId) {
      this.logger.warn(
        `Execution ${execution.id} has no channelId; skipping pause`,
      );
      return;
    }

    const context: ExecutionContext = {
      routineId,
      executionId: execution.id,
      botId: routine.botId,
      channelId: execution.channelId,
      title: routine.title,
      taskcastTaskId: execution.taskcastTaskId,
      tenantId: routine.tenantId,
    };

    try {
      await strategy.pause(context);

      await this.db
        .update(schema.routineExecutions)
        .set({ status: 'paused' })
        .where(eq(schema.routineExecutions.id, execution.id));

      await this.db
        .update(schema.routines)
        .set({ status: 'paused', updatedAt: new Date() })
        .where(eq(schema.routines.id, routineId));

      this.logger.log(`Routine ${routineId} paused`);
    } catch (error) {
      this.logger.warn(
        `Strategy pause failed for routine ${routineId}: ${error}`,
      );
    }
  }

  /**
   * Resume the paused execution for the given task.
   *
   * Note: Uses read-then-check pattern (not CAS) for status validation.
   * Duplicate resume commands are harmless — sendInput is idempotent
   * and DB writes are idempotent.
   */
  async resumeExecution(routineId: string, message?: string): Promise<void> {
    const [routine] = await this.db
      .select({
        id: schema.routines.id,
        botId: schema.routines.botId,
        tenantId: schema.routines.tenantId,
        title: schema.routines.title,
        currentExecutionId: schema.routines.currentExecutionId,
        status: schema.routines.status,
      })
      .from(schema.routines)
      .where(eq(schema.routines.id, routineId))
      .limit(1);

    if (!routine) {
      this.logger.error(`Routine ${routineId} not found`);
      return;
    }

    if (!routine.currentExecutionId || !routine.botId) {
      this.logger.warn(
        `Routine ${routineId} cannot be resumed — no active execution or bot`,
      );
      return;
    }

    if (routine.status !== 'paused') {
      this.logger.warn(
        `Routine ${routineId} cannot be resumed — current status is ${routine.status}`,
      );
      return;
    }

    const [execution] = await this.db
      .select()
      .from(schema.routineExecutions)
      .where(eq(schema.routineExecutions.id, routine.currentExecutionId))
      .limit(1);

    if (!execution) {
      this.logger.error(`Execution ${routine.currentExecutionId} not found`);
      return;
    }

    const [bot] = await this.db
      .select({
        type: schema.bots.type,
        managedProvider: schema.bots.managedProvider,
      })
      .from(schema.bots)
      .where(eq(schema.bots.id, routine.botId))
      .limit(1);

    if (!bot) {
      this.logger.error(`Bot not found: ${routine.botId}`);
      return;
    }

    const strategyKey = this.resolveStrategyKey(bot);
    const strategy = this.strategies.get(strategyKey);
    if (!strategy) {
      this.logger.error(`No strategy for bot type "${strategyKey}"`);
      return;
    }

    if (!execution.channelId) {
      this.logger.warn(
        `Execution ${execution.id} has no channelId; skipping resume`,
      );
      return;
    }

    const context: ExecutionContext = {
      routineId,
      executionId: execution.id,
      botId: routine.botId,
      channelId: execution.channelId,
      title: routine.title,
      taskcastTaskId: execution.taskcastTaskId,
      tenantId: routine.tenantId,
      message,
    };

    try {
      await strategy.resume(context);

      await this.db
        .update(schema.routineExecutions)
        .set({ status: 'in_progress' })
        .where(eq(schema.routineExecutions.id, execution.id));

      await this.db
        .update(schema.routines)
        .set({ status: 'in_progress', updatedAt: new Date() })
        .where(eq(schema.routines.id, routineId));

      this.logger.log(`Routine ${routineId} resumed`);
    } catch (error) {
      this.logger.warn(
        `Strategy resume failed for routine ${routineId}: ${error}`,
      );
    }
  }

  private resolveStrategyKey(bot: {
    type: string;
    managedProvider: string | null;
  }): string {
    return bot.managedProvider === 'hive' ? 'hive' : bot.type;
  }

  private async markExecutionFailed(
    executionId: string,
    routineId: string,
    error: { code: string; message: string },
  ): Promise<void> {
    const now = new Date();

    await this.db
      .update(schema.routineExecutions)
      .set({
        status: 'failed',
        completedAt: now,
        error,
      })
      .where(eq(schema.routineExecutions.id, executionId));

    await this.db
      .update(schema.routines)
      .set({
        status: 'failed',
        updatedAt: now,
      })
      .where(eq(schema.routines.id, routineId));
  }
}
