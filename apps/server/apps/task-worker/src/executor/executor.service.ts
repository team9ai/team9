import { Inject, Injectable, Logger } from '@nestjs/common';
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
  ExecutionContext,
  ExecutionStrategy,
} from './execution-strategy.interface.js';

@Injectable()
export class ExecutorService {
  private readonly logger = new Logger(ExecutorService.name);
  private readonly strategies = new Map<string, ExecutionStrategy>();

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
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
   * 1. Load task from DB
   * 2. Determine next version number
   * 3. Create task channel (type='task')
   * 4. Create execution record in DB
   * 5. Update task status to in_progress
   * 6. Look up bot's shadow userId from bots table
   * 7. Delegate to strategy (TODO markers for now)
   * 8. Log completion
   */
  async triggerExecution(taskId: string): Promise<void> {
    // ── 1. Load task ──────────────────────────────────────────────────
    const [task] = await this.db
      .select()
      .from(schema.agentTasks)
      .where(eq(schema.agentTasks.id, taskId))
      .limit(1);

    if (!task) {
      this.logger.error(`Task not found: ${taskId}`);
      return;
    }

    this.logger.log(`Starting execution for task ${taskId} ("${task.title}")`);

    // ── 2. Determine next version number ──────────────────────────────
    const [lastExecution] = await this.db
      .select({ version: schema.agentTaskExecutions.version })
      .from(schema.agentTaskExecutions)
      .where(eq(schema.agentTaskExecutions.taskId, taskId))
      .orderBy(desc(schema.agentTaskExecutions.version))
      .limit(1);

    const nextVersion = (lastExecution?.version ?? 0) + 1;

    // ── 3. Create task channel (type='task') ──────────────────────────
    const channelId = uuidv7();
    await this.db.insert(schema.channels).values({
      id: channelId,
      tenantId: task.tenantId,
      name: `task-${task.title.slice(0, 60).replace(/\s+/g, '-').toLowerCase()}-v${nextVersion}`,
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

    // ── 4. Create execution record ────────────────────────────────────
    const executionId = uuidv7();
    const taskcastTaskId = uuidv7(); // Placeholder — will be replaced by external system ID

    await this.db.insert(schema.agentTaskExecutions).values({
      id: executionId,
      taskId,
      version: nextVersion,
      status: 'in_progress',
      channelId,
      taskcastTaskId,
      startedAt: new Date(),
    });

    // ── 5. Update task status to in_progress ──────────────────────────
    await this.db
      .update(schema.agentTasks)
      .set({
        status: 'in_progress',
        currentExecutionId: executionId,
        updatedAt: new Date(),
      })
      .where(eq(schema.agentTasks.id, taskId));

    // ── 6. Look up bot's shadow userId ────────────────────────────────
    const [bot] = await this.db
      .select({ userId: schema.bots.userId, type: schema.bots.type })
      .from(schema.bots)
      .where(eq(schema.bots.id, task.botId))
      .limit(1);

    if (!bot) {
      this.logger.error(`Bot not found: ${task.botId}`);
      return;
    }

    // Add the bot's shadow user to the task channel
    await this.db.insert(schema.channelMembers).values({
      id: uuidv7(),
      channelId,
      userId: bot.userId,
      role: 'member',
    });

    // ── 7. Fetch document content (if linked) ─────────────────────────
    let documentContent: string | undefined;
    if (task.documentId) {
      const [docVersion] = await this.db
        .select({ content: schema.documentVersions.content })
        .from(schema.documents)
        .innerJoin(
          schema.documentVersions,
          eq(schema.documentVersions.id, schema.documents.currentVersionId),
        )
        .where(eq(schema.documents.id, task.documentId))
        .limit(1);

      documentContent = docVersion?.content;
    }

    // ── 8. Delegate to strategy ───────────────────────────────────────
    const strategy = this.strategies.get(bot.type);
    const context: ExecutionContext = {
      taskId,
      executionId,
      botId: task.botId,
      channelId,
      documentContent,
      taskcastTaskId,
    };

    if (strategy) {
      try {
        await strategy.execute(context);
        this.logger.log(
          `Execution ${executionId} (v${nextVersion}) delegated to ${bot.type} strategy`,
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

        // Update execution record with failed status and error details
        await this.db
          .update(schema.agentTaskExecutions)
          .set({
            status: 'failed',
            completedAt: now,
            error: {
              message: errorMessage,
              details: errorStack,
            },
          })
          .where(eq(schema.agentTaskExecutions.id, executionId));

        // Update task status to failed
        await this.db
          .update(schema.agentTasks)
          .set({
            status: 'failed',
            updatedAt: now,
          })
          .where(eq(schema.agentTasks.id, taskId));

        return;
      }
    } else {
      this.logger.warn(
        `No strategy registered for bot type "${bot.type}", skipping delegation`,
      );
    }

    // ── 9. Log completion ─────────────────────────────────────────────
    this.logger.log(
      `Execution ${executionId} (v${nextVersion}) initiated for task ${taskId}`,
    );
  }
}
