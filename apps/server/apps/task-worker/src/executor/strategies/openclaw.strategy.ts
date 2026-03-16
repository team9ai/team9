import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type {
  ExecutionStrategy,
  ExecutionContext,
} from '../execution-strategy.interface.js';

type OpenclawSecrets = {
  instanceResult?: {
    access_url?: string;
    instance?: {
      access_url?: string;
    };
  };
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
      .where(eq(schema.bots.id, context.botId))
      .limit(1);

    if (!bot) {
      throw new Error(`OpenClaw bot not found: ${context.botId}`);
    }

    const agentId = bot.extra?.openclaw?.agentId ?? 'default';
    const secrets = bot.secrets as OpenclawSecrets | null;
    const openclawUrl =
      secrets?.instanceResult?.access_url ??
      secrets?.instanceResult?.instance?.access_url;

    if (!openclawUrl) {
      throw new Error(`OpenClaw URL not configured for bot ${context.botId}`);
    }

    const response = await fetch(
      new URL(
        `/api/agents/${encodeURIComponent(agentId)}/execute`,
        openclawUrl,
      ),
      {
        method: 'POST',
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenClaw execute failed for agent ${agentId} (${response.status}): ${errorText || response.statusText}`,
      );
    }
  }

  async pause(context: ExecutionContext): Promise<void> {
    this.logger.log(`Pausing OpenClaw agent for task ${context.taskId}`);
    // TODO: POST {openclaw_url}/api/agents/{agentId}/pause
  }

  async resume(context: ExecutionContext): Promise<void> {
    this.logger.log(`Resuming OpenClaw agent for task ${context.taskId}`);
    // TODO: POST {openclaw_url}/api/agents/{agentId}/resume
  }

  async stop(context: ExecutionContext): Promise<void> {
    this.logger.log(`Stopping OpenClaw agent for task ${context.taskId}`);
    // TODO: POST {openclaw_url}/api/agents/{agentId}/stop
  }
}
