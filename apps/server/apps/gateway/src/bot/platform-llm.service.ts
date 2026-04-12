import { Injectable, Inject, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createOpenAI } from '@ai-sdk/openai';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { RedisService } from '@team9/redis';
import type { BotService } from './bot.service.js';

const PLATFORM_BOT_DISPLAY_NAME = 'Platform LLM Service';
const PLATFORM_BOT_TOKEN_CACHE_PREFIX = 'platform-llm-token:';
const PLATFORM_BOT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Shared service for creating Vercel AI SDK provider instances
 * authenticated via the tenant's platform bot token through
 * capability-hub's OpenRouter proxy.
 */
@Injectable()
export class PlatformLlmService {
  private readonly logger = new Logger(PlatformLlmService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly moduleRef: ModuleRef,
    private readonly redisService: RedisService,
  ) {}

  /** Lazily resolve BotService to avoid ESM circular dependency at import time */
  private get botService(): BotService {
    return this.moduleRef.get('BotService', { strict: false });
  }

  /**
   * Create a Vercel AI SDK OpenAI-compatible provider for the given tenant.
   *
   * Usage:
   * ```ts
   * const llm = await this.platformLlmService.createProvider(tenantId);
   * const result = await generateText({ model: llm('anthropic/claude-sonnet-4-6'), ... });
   * ```
   */
  async createProvider(tenantId: string) {
    const token = await this.getOrCreateToken(tenantId);
    return createOpenAI({
      baseURL: `${process.env.CAPABILITY_HUB_URL}/api/proxy/openrouter`,
      apiKey: token,
    });
  }

  /**
   * Get a cached platform bot token or create a new platform bot for the tenant.
   */
  private async getOrCreateToken(tenantId: string): Promise<string> {
    const cacheKey = `${PLATFORM_BOT_TOKEN_CACHE_PREFIX}${tenantId}`;

    const cached = await this.redisService.get(cacheKey);
    if (cached) return cached;

    // Find existing platform-llm bot for this tenant (via installed_applications join)
    const [existing] = await this.db
      .select({ botId: schema.bots.id })
      .from(schema.bots)
      .innerJoin(
        schema.installedApplications,
        eq(schema.bots.installedApplicationId, schema.installedApplications.id),
      )
      .where(
        and(
          eq(schema.installedApplications.tenantId, tenantId),
          eq(schema.bots.type, 'system'),
          eq(schema.bots.isActive, true),
          eq(schema.bots.managedProvider, 'platform-llm'),
        ),
      )
      .limit(1);

    let botId: string;

    if (existing) {
      botId = existing.botId;
    } else {
      // Find any installed app for the tenant to satisfy the FK
      const [app] = await this.db
        .select({ id: schema.installedApplications.id })
        .from(schema.installedApplications)
        .where(
          and(
            eq(schema.installedApplications.tenantId, tenantId),
            eq(schema.installedApplications.isActive, true),
          ),
        )
        .limit(1);

      if (!app) {
        throw new Error(
          `No installed application found for tenant ${tenantId}`,
        );
      }

      // Find a tenant member as bot owner
      const [member] = await this.db
        .select({ userId: schema.tenantMembers.userId })
        .from(schema.tenantMembers)
        .where(eq(schema.tenantMembers.tenantId, tenantId))
        .limit(1);

      if (!member) {
        throw new Error(`No members found for tenant ${tenantId}`);
      }

      const { bot } = await this.botService.createWorkspaceBot({
        ownerId: member.userId,
        tenantId,
        displayName: PLATFORM_BOT_DISPLAY_NAME,
        type: 'system',
        installedApplicationId: app.id,
        generateToken: false,
        managedProvider: 'platform-llm',
      });
      botId = bot.botId;
      this.logger.log(
        `Created platform LLM bot ${botId} for tenant ${tenantId}`,
      );
    }

    const { accessToken } = await this.botService.generateAccessToken(botId);

    await this.redisService.set(
      cacheKey,
      accessToken,
      PLATFORM_BOT_TOKEN_TTL_SECONDS,
    );

    return accessToken;
  }
}
