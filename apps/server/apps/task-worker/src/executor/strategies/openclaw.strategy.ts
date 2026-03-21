import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { env } from '@team9/shared';
import type {
  ExecutionStrategy,
  ExecutionContext,
} from '../execution-strategy.interface.js';

type OpenclawConfig = {
  agentId: string;
  openclawUrl: string;
  gatewayToken: string | undefined;
};

@Injectable()
export class OpenclawStrategy implements ExecutionStrategy {
  private readonly logger = new Logger(OpenclawStrategy.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async execute(context: ExecutionContext): Promise<void> {
    this.logger.log(`Starting OpenClaw agent for task ${context.taskId}`);

    const message = context.documentContent?.trim() || context.title?.trim();
    if (!message) {
      throw new Error(
        `Task ${context.taskId} has no document content or title — cannot execute without instructions`,
      );
    }

    const { agentId, openclawUrl, gatewayToken } =
      await this.resolveOpenclawConfig(context.botId);

    const body = {
      message,
      idempotencyKey: context.taskcastTaskId ?? `exec_${context.executionId}`,
      sessionKey: `agent:${agentId}:task:${context.taskId}`,
      channelId: context.channelId,
      timeout: 86400,
      task: {
        taskId: context.taskId,
        executionId: context.executionId,
      },
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (gatewayToken) {
      headers['Authorization'] = `Bearer ${gatewayToken}`;
    } else {
      this.logger.warn(
        `No gateway token for bot ${context.botId}, sending without auth`,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(
        new URL(
          `/api/agents/${encodeURIComponent(agentId)}/execute`,
          openclawUrl,
        ),
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `OpenClaw execute failed (${response.status}): ${errorText || response.statusText}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async pause(context: ExecutionContext): Promise<void> {
    this.logger.warn(
      `Pause not yet supported for task ${context.taskId} — OpenClaw does not support agent checkpointing`,
    );
  }

  async resume(context: ExecutionContext): Promise<void> {
    this.logger.warn(
      `Resume not yet supported for task ${context.taskId} — OpenClaw does not support agent checkpointing`,
    );
  }

  async stop(context: ExecutionContext): Promise<void> {
    this.logger.log(`Stopping OpenClaw agent for task ${context.taskId}`);

    const { agentId, openclawUrl, gatewayToken } =
      await this.resolveOpenclawConfig(context.botId);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (gatewayToken) {
      headers['Authorization'] = `Bearer ${gatewayToken}`;
    }

    try {
      await fetch(
        new URL(`/api/agents/${encodeURIComponent(agentId)}/stop`, openclawUrl),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            sessionKey: `agent:${agentId}:task:${context.taskId}`,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      // Don't throw on non-2xx — the run may have already finished
    } catch (error) {
      this.logger.warn(
        `Failed to stop OpenClaw agent for task ${context.taskId}: ${error}`,
      );
    }
  }

  private async resolveOpenclawConfig(botId: string): Promise<OpenclawConfig> {
    const [bot] = await this.db
      .select({
        extra: schema.bots.extra,
        secrets: schema.installedApplications.secrets,
      })
      .from(schema.bots)
      .leftJoin(
        schema.installedApplications,
        eq(schema.installedApplications.id, schema.bots.installedApplicationId),
      )
      .where(eq(schema.bots.id, botId))
      .limit(1);

    if (!bot) {
      throw new Error(`OpenClaw bot not found: ${botId}`);
    }

    const agentId =
      (bot.extra as Record<string, any>)?.openclaw?.agentId ?? 'main';

    const secrets = bot.secrets as Record<string, any> | null;
    const instanceResult = secrets?.instanceResult;
    const openclawUrl =
      instanceResult?.access_url ??
      instanceResult?.instance?.access_url ??
      env.OPENCLAW_INSTANCE_URL;

    if (!openclawUrl) {
      throw new Error(`OpenClaw URL not configured for bot ${botId}`);
    }

    const gatewayToken: string | undefined =
      instanceResult?.gateway_token ??
      instanceResult?.instance?.gateway_token ??
      env.OPENCLAW_GATEWAY_TOKEN;

    return { agentId, openclawUrl, gatewayToken };
  }
}
