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

@Injectable()
export class ExecutorService {
  private readonly logger = new Logger(ExecutorService.name);
  private readonly strategies = new Map<string, ExecutionStrategy>();

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly taskCastClient: TaskCastClient,
  ) {}

  /**
   * Register an execution strategy for a given bot type.
   */
  registerStrategy(botType: string, strategy: ExecutionStrategy): void {
    this.strategies.set(botType, strategy);
    this.logger.log(`Registered execution strategy for bot type: ${botType}`);
  }

  /**
   * Trigger a full execution lifecycle for the given task.
   *
   * 1. CAS: claim the task atomically (must be first — prevents duplicate executions)
   * 2. Create task channel (type='task')
   * 3. Fetch document content (if linked)
   * 4. Create execution record in DB (with task version snapshot)
   * 5. Update task with currentExecutionId
   * 6. Look up bot's shadow userId from bots table
   * 7. Delegate to strategy
   * 8. Log completion
   */
  async triggerExecution(
    taskId: string,
    opts?: {
      triggerId?: string;
      triggerType?: string;
      triggerContext?: Record<string, unknown>;
      sourceExecutionId?: string;
      documentVersionId?: string;
    },
  ): Promise<void> {
    // ── 1. CAS: claim the task (must be first — before any resource creation) ──
    const claimed = await this.db
      .update(schema.routines)
      .set({ status: 'in_progress', updatedAt: new Date() })
      .where(
        and(
          eq(schema.routines.id, taskId),
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
        `Task ${taskId} cannot start execution — status not eligible or already active`,
      );
      return;
    }

    const task = claimed[0];
    this.logger.log(`Starting execution for task ${taskId} ("${task.title}")`);

    if (!task.botId) {
      this.logger.error(`Task ${taskId} has no bot assigned, cannot execute`);
      // Release CAS — mark as failed so it can be retried
      await this.db
        .update(schema.routines)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(schema.routines.id, taskId));
      return;
    }

    // ── 2. Create task channel (type='task') ──────────────────────────
    const channelId = uuidv7();
    await this.db.insert(schema.channels).values({
      id: channelId,
      tenantId: task.tenantId,
      name: `task-${task.title.slice(0, 60).replace(/\s+/g, '-').toLowerCase()}-${channelId.slice(-6)}`,
      type: 'task',
      createdBy: task.creatorId,
    });

    // Add the task creator as a channel member
    await this.db.insert(schema.channelMembers).values({
      id: uuidv7(),
      channelId,
      userId: task.creatorId,
      role: 'owner',
    });

    // ── 3. Fetch document content (if linked) ─────────────────────────
    let documentContent: string | undefined;
    let documentVersionId: string | undefined;
    if (task.documentId) {
      const [docVersion] = await this.db
        .select({
          content: schema.documentVersions.content,
          versionId: schema.documentVersions.id,
        })
        .from(schema.documents)
        .innerJoin(
          schema.documentVersions,
          eq(schema.documentVersions.id, schema.documents.currentVersionId),
        )
        .where(eq(schema.documents.id, task.documentId))
        .limit(1);

      documentContent = docVersion?.content;
      documentVersionId = docVersion?.versionId;
    }

    if (opts?.documentVersionId) {
      documentVersionId = opts.documentVersionId;
    }

    // ── 4. Create execution record ────────────────────────────────────
    const executionId = uuidv7();
    const taskcastTaskId = await this.taskCastClient.createTask({
      taskId,
      executionId,
      botId: task.botId,
      tenantId: task.tenantId,
      ttl: 86400,
    });

    await this.db.insert(schema.routineExecutions).values({
      id: executionId,
      routineId: taskId,
      routineVersion: task.version,
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

    // ── 5. Update task with currentExecutionId ────────────────────────
    await this.db
      .update(schema.routines)
      .set({ currentExecutionId: executionId })
      .where(eq(schema.routines.id, taskId));

    // ── 6. Look up bot's shadow userId ────────────────────────────────
    const [bot] = await this.db
      .select({
        userId: schema.bots.userId,
        type: schema.bots.type,
        managedProvider: schema.bots.managedProvider,
      })
      .from(schema.bots)
      .where(eq(schema.bots.id, task.botId))
      .limit(1);

    if (!bot) {
      this.logger.error(`Bot not found: ${task.botId}`);
      await this.markExecutionFailed(executionId, taskId, {
        code: 'BOT_NOT_FOUND',
        message: `Bot ${task.botId} not found`,
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
      taskId,
      executionId,
      botId: task.botId,
      channelId,
      title: task.title,
      documentContent,
      taskcastTaskId,
      tenantId: task.tenantId,
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
          `Strategy execution failed for task ${taskId}: ${errorMessage}`,
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
          .where(eq(schema.routines.id, taskId));

        return;
      }
    } else {
      this.logger.error(`No strategy registered for bot type "${strategyKey}"`);
      await this.markExecutionFailed(executionId, taskId, {
        code: 'NO_STRATEGY',
        message: `No execution strategy registered for bot type "${strategyKey}"`,
      });
      return;
    }

    // ── 8. Log completion ──────────────────────────────────────────────
    this.logger.log(`Execution ${executionId} initiated for task ${taskId}`);
  }

  /**
   * Stop the currently active execution for the given task.
   */
  async stopExecution(taskId: string): Promise<void> {
    // 1. Load task
    const [task] = await this.db
      .select({
        id: schema.routines.id,
        botId: schema.routines.botId,
        tenantId: schema.routines.tenantId,
        title: schema.routines.title,
        currentExecutionId: schema.routines.currentExecutionId,
      })
      .from(schema.routines)
      .where(eq(schema.routines.id, taskId))
      .limit(1);

    if (!task) {
      this.logger.error(`Task not found for stop: ${taskId}`);
      return;
    }

    if (!task.currentExecutionId) {
      this.logger.warn(`Task ${taskId} has no active execution to stop`);
      return;
    }

    if (!task.botId) {
      this.logger.error(`Task ${taskId} has no bot assigned`);
      return;
    }

    // 2. Load execution
    const [execution] = await this.db
      .select()
      .from(schema.routineExecutions)
      .where(eq(schema.routineExecutions.id, task.currentExecutionId))
      .limit(1);

    if (!execution) {
      this.logger.error(`Execution ${task.currentExecutionId} not found`);
      return;
    }

    // 3. Look up bot type → get strategy
    const [bot] = await this.db
      .select({
        type: schema.bots.type,
        managedProvider: schema.bots.managedProvider,
      })
      .from(schema.bots)
      .where(eq(schema.bots.id, task.botId))
      .limit(1);

    if (!bot) {
      this.logger.error(`Bot not found: ${task.botId}`);
      await this.markExecutionFailed(task.currentExecutionId, taskId, {
        code: 'BOT_NOT_FOUND',
        message: `Bot ${task.botId} not found`,
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
        `Execution ${execution.id} for task ${taskId} has no channelId; skipping strategy.stop`,
      );
    } else {
      const context: ExecutionContext = {
        taskId,
        executionId: execution.id,
        botId: task.botId,
        channelId: execution.channelId,
        title: task.title,
        taskcastTaskId: execution.taskcastTaskId,
        tenantId: task.tenantId,
      };

      try {
        await strategy.stop(context);
      } catch (error) {
        this.logger.warn(`Strategy stop failed for task ${taskId}: ${error}`);
      }
    }

    // 5. Update execution + task status to stopped
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
      .where(eq(schema.routines.id, taskId));

    this.logger.log(`Execution ${execution.id} stopped for task ${taskId}`);
  }

  /**
   * Pause the currently active execution for the given task.
   *
   * Note: Uses read-then-check pattern (not CAS) for status validation.
   * Duplicate pause commands are harmless — interruptSession is idempotent
   * (404 swallowed by HiveStrategy) and DB writes are idempotent.
   */
  async pauseExecution(taskId: string): Promise<void> {
    const [task] = await this.db
      .select({
        id: schema.routines.id,
        botId: schema.routines.botId,
        tenantId: schema.routines.tenantId,
        title: schema.routines.title,
        currentExecutionId: schema.routines.currentExecutionId,
        status: schema.routines.status,
      })
      .from(schema.routines)
      .where(eq(schema.routines.id, taskId))
      .limit(1);

    if (!task) {
      this.logger.error(`Task ${taskId} not found`);
      return;
    }

    if (!task.currentExecutionId || !task.botId) {
      this.logger.warn(
        `Task ${taskId} cannot be paused — no active execution or bot`,
      );
      return;
    }

    if (task.status !== 'in_progress') {
      this.logger.warn(
        `Task ${taskId} cannot be paused — current status is ${task.status}`,
      );
      return;
    }

    const [execution] = await this.db
      .select()
      .from(schema.routineExecutions)
      .where(eq(schema.routineExecutions.id, task.currentExecutionId))
      .limit(1);

    if (!execution) {
      this.logger.error(`Execution ${task.currentExecutionId} not found`);
      return;
    }

    const [bot] = await this.db
      .select({
        type: schema.bots.type,
        managedProvider: schema.bots.managedProvider,
      })
      .from(schema.bots)
      .where(eq(schema.bots.id, task.botId))
      .limit(1);

    if (!bot) {
      this.logger.error(`Bot not found: ${task.botId}`);
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
      taskId,
      executionId: execution.id,
      botId: task.botId,
      channelId: execution.channelId,
      title: task.title,
      taskcastTaskId: execution.taskcastTaskId,
      tenantId: task.tenantId,
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
        .where(eq(schema.routines.id, taskId));

      this.logger.log(`Task ${taskId} paused`);
    } catch (error) {
      this.logger.warn(`Strategy pause failed for task ${taskId}: ${error}`);
    }
  }

  /**
   * Resume the paused execution for the given task.
   *
   * Note: Uses read-then-check pattern (not CAS) for status validation.
   * Duplicate resume commands are harmless — sendInput is idempotent
   * and DB writes are idempotent.
   */
  async resumeExecution(taskId: string, message?: string): Promise<void> {
    const [task] = await this.db
      .select({
        id: schema.routines.id,
        botId: schema.routines.botId,
        tenantId: schema.routines.tenantId,
        title: schema.routines.title,
        currentExecutionId: schema.routines.currentExecutionId,
        status: schema.routines.status,
      })
      .from(schema.routines)
      .where(eq(schema.routines.id, taskId))
      .limit(1);

    if (!task) {
      this.logger.error(`Task ${taskId} not found`);
      return;
    }

    if (!task.currentExecutionId || !task.botId) {
      this.logger.warn(
        `Task ${taskId} cannot be resumed — no active execution or bot`,
      );
      return;
    }

    if (task.status !== 'paused') {
      this.logger.warn(
        `Task ${taskId} cannot be resumed — current status is ${task.status}`,
      );
      return;
    }

    const [execution] = await this.db
      .select()
      .from(schema.routineExecutions)
      .where(eq(schema.routineExecutions.id, task.currentExecutionId))
      .limit(1);

    if (!execution) {
      this.logger.error(`Execution ${task.currentExecutionId} not found`);
      return;
    }

    const [bot] = await this.db
      .select({
        type: schema.bots.type,
        managedProvider: schema.bots.managedProvider,
      })
      .from(schema.bots)
      .where(eq(schema.bots.id, task.botId))
      .limit(1);

    if (!bot) {
      this.logger.error(`Bot not found: ${task.botId}`);
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
      taskId,
      executionId: execution.id,
      botId: task.botId,
      channelId: execution.channelId,
      title: task.title,
      taskcastTaskId: execution.taskcastTaskId,
      tenantId: task.tenantId,
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
        .where(eq(schema.routines.id, taskId));

      this.logger.log(`Task ${taskId} resumed`);
    } catch (error) {
      this.logger.warn(`Strategy resume failed for task ${taskId}: ${error}`);
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
    taskId: string,
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
      .where(eq(schema.routines.id, taskId));
  }
}
