import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { ClawHiveService } from '@team9/claw-hive';
import type {
  ExecutionStrategy,
  ExecutionContext,
} from '../execution-strategy.interface.js';

@Injectable()
export class HiveStrategy implements ExecutionStrategy {
  private readonly logger = new Logger(HiveStrategy.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clawHiveService: ClawHiveService,
  ) {}

  async execute(context: ExecutionContext): Promise<void> {
    this.logger.log(`Starting Hive agent for task ${context.taskId}`);
    const { agentId } = await this.resolveHiveConfig(context.botId);
    const sessionId = this.buildSessionId(
      context.tenantId,
      agentId,
      context.taskId,
    );

    await this.clawHiveService.sendInput(
      sessionId,
      {
        type: 'team9:task.start',
        source: 'team9',
        timestamp: new Date().toISOString(),
        payload: {
          taskId: context.taskId,
          executionId: context.executionId,
          channelId: context.channelId,
          title: context.title,
          ...(context.documentContent !== undefined
            ? { documentContent: context.documentContent }
            : {}),
          location: { type: 'task', id: context.channelId },
        },
      },
      context.tenantId,
    );
  }

  async pause(context: ExecutionContext): Promise<void> {
    this.logger.log(`Pausing Hive agent for task ${context.taskId}`);
    const { agentId } = await this.resolveHiveConfig(context.botId);
    const sessionId = this.buildSessionId(
      context.tenantId,
      agentId,
      context.taskId,
    );
    try {
      await this.clawHiveService.interruptSession(sessionId, context.tenantId);
    } catch (error) {
      // Session already ended (404) — expected, swallow it
      if (error instanceof Error && error.message.includes('404')) {
        this.logger.warn(
          `Session ${sessionId} already ended during pause: ${error.message}`,
        );
        return;
      }
      // Other errors (API down, 500, network) — re-throw so ExecutorService doesn't falsely update DB status
      throw error;
    }
  }

  async resume(context: ExecutionContext): Promise<void> {
    this.logger.log(`Resuming Hive agent for task ${context.taskId}`);
    const { agentId } = await this.resolveHiveConfig(context.botId);
    const sessionId = this.buildSessionId(
      context.tenantId,
      agentId,
      context.taskId,
    );
    await this.clawHiveService.sendInput(
      sessionId,
      {
        type: 'team9:task.resume',
        source: 'team9',
        timestamp: new Date().toISOString(),
        payload: {
          taskId: context.taskId,
          executionId: context.executionId,
          message: context.message,
        },
      },
      context.tenantId,
    );
  }

  async stop(context: ExecutionContext): Promise<void> {
    this.logger.log(`Stopping Hive agent for task ${context.taskId}`);
    const { agentId } = await this.resolveHiveConfig(context.botId);
    const sessionId = this.buildSessionId(
      context.tenantId,
      agentId,
      context.taskId,
    );
    await this.clawHiveService.deleteSession(sessionId, context.tenantId);
  }

  private buildSessionId(
    tenantId: string,
    agentId: string,
    taskId: string,
  ): string {
    return `team9/${tenantId}/${agentId}/task/${taskId}`;
  }

  private async resolveHiveConfig(botId: string): Promise<{ agentId: string }> {
    const [bot] = await this.db
      .select({ managedMeta: schema.bots.managedMeta })
      .from(schema.bots)
      .where(eq(schema.bots.id, botId))
      .limit(1);

    if (!bot) {
      throw new Error(`Hive bot not found: ${botId}`);
    }

    const agentId = (bot.managedMeta as Record<string, unknown> | null)
      ?.agentId as string | undefined;

    if (!agentId) {
      throw new Error(`Hive agentId not configured for bot ${botId}`);
    }
    return { agentId };
  }
}
