import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { BotExtra } from '@team9/database/schemas';
import { ClawHiveService } from '@team9/claw-hive';
import { RedisService } from '@team9/redis';
import { streamText, Output } from 'ai';
import { z } from 'zod';
import { createOpenAI } from '@ai-sdk/openai';
import { BotService } from '../bot/bot.service.js';
import type { GenerateCandidatesDto } from './dto/generate-persona.dto.js';

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface StaffBotResult {
  botId: string;
  userId: string;
  agentId: string;
  displayName: string | undefined;
}

export interface CreateStaffBotOptions {
  /** Prefix for the claw-hive agent ID, e.g. "common-staff" or "personal-staff" */
  agentIdPrefix: string;
  /** Blueprint ID for claw-hive agent registration */
  blueprintId: string;
  /** Owner (creator) user ID */
  ownerId: string;
  /** Tenant (workspace) ID */
  tenantId: string;
  /** Display name for the bot */
  displayName: string;
  /** Installed application ID to link the bot */
  installedApplicationId: string;
  /** Mentor user ID */
  mentorId: string;
  /** Avatar URL for the bot user */
  avatarUrl?: string;
  /** Model configuration */
  model: { provider: string; id: string };
  /** Bot extra data (e.g. commonStaff, personalStaff) */
  botExtra: BotExtra;
  /** Extra component configs merged into the claw-hive registration */
  extraComponentConfigs?: Record<string, Record<string, unknown>>;
}

export interface UpdateStaffBotOptions {
  /** Prefix for the claw-hive agent ID */
  agentIdPrefix: string;
  /** Bot ID */
  botId: string;
  /** Bot's user ID (for avatar update) */
  botUserId: string;
  /** Tenant ID */
  tenantId: string;
  /** Display name update */
  displayName?: string;
  /** Mentor ID update */
  mentorId?: string | null;
  /** Avatar URL update */
  avatarUrl?: string;
  /** Model update */
  model?: { provider: string; id: string };
  /** The full merged BotExtra to persist */
  botExtra: BotExtra;
  /** The current mentor ID on the bot (for claw-hive sync fallback) */
  currentMentorId: string | null;
}

export interface DeleteStaffBotOptions {
  /** Prefix for the claw-hive agent ID */
  agentIdPrefix: string;
  /** Bot ID */
  botId: string;
}

export interface GeneratePersonaOptions {
  tenantId: string;
  installedApplicationId: string;
  displayName?: string;
  roleTitle?: string;
  existingPersona?: string;
  prompt?: string;
  jobDescription?: string;
}

export interface GenerateAvatarOptions {
  style: string;
  displayName?: string;
  roleTitle?: string;
  persona?: string;
  prompt?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const PLATFORM_BOT_DISPLAY_NAME = 'Platform LLM Service';
const PLATFORM_BOT_TOKEN_CACHE_PREFIX = 'platform-llm-token:';
const PLATFORM_BOT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// ── Candidate generation schema ──────────────────────────────────────────────

const candidateSchema = z.object({
  candidates: z.array(
    z.object({
      candidateIndex: z.number(),
      displayName: z.string(),
      roleTitle: z.string(),
      persona: z.string(),
      summary: z.string(),
    }),
  ),
});

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly botService: BotService,
    private readonly clawHiveService: ClawHiveService,
    private readonly redisService: RedisService,
  ) {}

  // ── Platform bot token management ───────────────────────────────────────

  /**
   * Get or create a platform bot for the given tenant, returning a valid
   * `t9bot_*` token cached in Redis.
   *
   * The platform bot is a dedicated system bot whose sole purpose is to
   * authenticate server-side LLM proxy calls via capability-hub.  Its token
   * is never shared with claw-hive, so regenerating it is safe.
   */
  private async getPlatformBotToken(
    tenantId: string,
    installedApplicationId: string,
  ): Promise<string> {
    const cacheKey = `${PLATFORM_BOT_TOKEN_CACHE_PREFIX}${tenantId}`;

    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Look up existing platform bot for this tenant + installed app
    const rows = await this.db
      .select({ botId: schema.bots.id })
      .from(schema.bots)
      .where(
        and(
          eq(schema.bots.installedApplicationId, installedApplicationId),
          eq(schema.bots.type, 'system'),
          eq(schema.bots.isActive, true),
          eq(schema.bots.managedProvider, 'platform-llm'),
        ),
      )
      .limit(1);

    let botId: string;

    if (rows.length > 0) {
      botId = rows[0].botId;
    } else {
      // Find any tenant member as owner (platform bot is system-level, owner is just a FK)
      const [member] = await this.db
        .select({ userId: schema.tenantMembers.userId })
        .from(schema.tenantMembers)
        .where(eq(schema.tenantMembers.tenantId, tenantId))
        .limit(1);

      if (!member) {
        throw new Error(
          `No members found for tenant ${tenantId} — cannot create platform bot`,
        );
      }

      // Create a dedicated platform bot
      const { bot } = await this.botService.createWorkspaceBot({
        ownerId: member.userId,
        tenantId,
        displayName: PLATFORM_BOT_DISPLAY_NAME,
        type: 'system',
        installedApplicationId,
        generateToken: false,
        managedProvider: 'platform-llm',
      });
      botId = bot.botId;
      this.logger.log(
        `Created platform LLM bot ${botId} for tenant ${tenantId}`,
      );
    }

    // Generate a fresh token and cache it
    const { accessToken } = await this.botService.generateAccessToken(botId);

    await this.redisService.set(
      cacheKey,
      accessToken,
      PLATFORM_BOT_TOKEN_TTL_SECONDS,
    );

    return accessToken;
  }

  /**
   * Create a Vercel AI SDK provider instance authenticated with the
   * tenant's platform bot token via capability-hub proxy.
   */
  private async createLlmProvider(
    tenantId: string,
    installedApplicationId: string,
  ) {
    const token = await this.getPlatformBotToken(
      tenantId,
      installedApplicationId,
    );
    return createOpenAI({
      baseURL: `${process.env.CAPABILITY_HUB_URL}/api/proxy/openrouter`,
      apiKey: token,
    });
  }

  /**
   * Create a bot with claw-hive agent registration.
   *
   * Steps:
   * 1. Create bot via BotService with managedProvider=hive
   * 2. Set managedMeta.agentId
   * 3. Optionally update avatar
   * 4. Set BotExtra
   * 5. Register agent with claw-hive
   * 6. On failure, rollback bot + agent
   */
  async createBotWithAgent(
    options: CreateStaffBotOptions,
  ): Promise<StaffBotResult> {
    const {
      agentIdPrefix,
      blueprintId,
      ownerId,
      tenantId,
      displayName,
      installedApplicationId,
      mentorId,
      avatarUrl,
      model,
      botExtra,
      extraComponentConfigs,
    } = options;

    // 1. Create bot with managedProvider=hive
    const { bot, accessToken } = await this.botService.createWorkspaceBot({
      ownerId,
      tenantId,
      displayName,
      type: 'system',
      installedApplicationId,
      generateToken: true,
      mentorId,
      managedProvider: 'hive',
    });

    const agentId = `${agentIdPrefix}-${bot.botId}`;

    try {
      // 2. Update managedMeta with agentId
      await this.db
        .update(schema.bots)
        .set({
          managedMeta: { agentId },
          updatedAt: new Date(),
        })
        .where(eq(schema.bots.id, bot.botId));

      // 3. Update avatar if provided
      if (avatarUrl !== undefined) {
        await this.db
          .update(schema.users)
          .set({ avatarUrl, updatedAt: new Date() })
          .where(eq(schema.users.id, bot.userId));
      }

      // 4. Set BotExtra
      await this.botService.updateBotExtra(bot.botId, botExtra);

      // 5. Register agent with claw-hive
      await this.clawHiveService.registerAgent({
        id: agentId,
        name: displayName,
        blueprintId,
        tenantId,
        metadata: {
          tenantId,
          botId: bot.botId,
          mentorId,
        },
        model,
        componentConfigs: {
          'system-prompt': { prompt: 'You are a helpful AI assistant.' },
          team9: {
            team9AuthToken: accessToken!,
            botUserId: bot.userId,
          },
          ...extraComponentConfigs,
        },
      });

      this.logger.log(
        `Registered claw-hive agent ${agentId} for bot ${bot.botId}`,
      );
    } catch (error) {
      // Rollback: clean up any created external resources
      this.logger.error(
        `Failed to create staff bot, rolling back bot ${bot.botId}`,
        error,
      );
      try {
        await this.clawHiveService.deleteAgent(agentId);
      } catch (agentCleanupError) {
        this.logger.warn(
          `Failed to clean up claw-hive agent ${agentId} during rollback`,
          agentCleanupError,
        );
      }
      try {
        await this.botService.deleteBotAndCleanup(bot.botId);
      } catch (cleanupError) {
        this.logger.warn(
          `Failed to clean up bot ${bot.botId} during rollback`,
          cleanupError,
        );
      }
      throw error;
    }

    return {
      botId: bot.botId,
      userId: bot.userId,
      agentId,
      displayName,
    };
  }

  /**
   * Update bot fields and sync to claw-hive.
   *
   * Steps:
   * 1. Update display name if provided
   * 2. Update mentor if provided
   * 3. Update avatar if provided
   * 4. Update BotExtra
   * 5. Sync to claw-hive
   */
  async updateBotAndAgent(options: UpdateStaffBotOptions): Promise<void> {
    const {
      agentIdPrefix,
      botId,
      botUserId,
      tenantId,
      displayName,
      mentorId,
      avatarUrl,
      model,
      botExtra,
      currentMentorId,
    } = options;

    // 1. Update display name
    if (displayName !== undefined) {
      await this.botService.updateBotDisplayName(botId, displayName);
    }

    // 2. Update mentor
    if (mentorId !== undefined) {
      await this.botService.updateBotMentor(botId, mentorId || null);
    }

    // 3. Update avatar
    if (avatarUrl !== undefined) {
      await this.db
        .update(schema.users)
        .set({ avatarUrl, updatedAt: new Date() })
        .where(eq(schema.users.id, botUserId));
    }

    // 4. Update BotExtra
    await this.botService.updateBotExtra(botId, botExtra);

    // 5. Sync to claw-hive
    const agentId = `${agentIdPrefix}-${botId}`;

    await this.clawHiveService.updateAgent(agentId, {
      tenantId,
      metadata: {
        tenantId,
        botId,
        mentorId:
          mentorId !== undefined ? mentorId || null : (currentMentorId ?? null),
      },
      ...(displayName !== undefined ? { name: displayName } : {}),
      ...(model !== undefined ? { model } : {}),
    });

    this.logger.log(`Updated claw-hive agent ${agentId} for bot ${botId}`);
  }

  /**
   * Delete claw-hive agent and cleanup bot.
   */
  async deleteBotAndAgent(options: DeleteStaffBotOptions): Promise<void> {
    const { agentIdPrefix, botId } = options;
    const agentId = `${agentIdPrefix}-${botId}`;

    // Delete claw-hive agent first
    try {
      await this.clawHiveService.deleteAgent(agentId);
      this.logger.log(`Deleted claw-hive agent ${agentId}`);
    } catch (error) {
      this.logger.warn(
        `Failed to delete claw-hive agent ${agentId}, continuing with bot cleanup`,
        error,
      );
    }

    // Delete bot and cleanup
    await this.botService.deleteBotAndCleanup(botId);
    this.logger.log(`Deleted bot ${botId}`);
  }

  /**
   * Generate a personality-rich persona via streaming AI response.
   *
   * When `existingPersona` is provided the AI expands/refines it rather than
   * starting from scratch.  The user-supplied `prompt` is treated as the
   * highest-priority guidance.
   *
   * @returns AsyncGenerator that yields text chunks suitable for an SSE stream.
   */
  async *generatePersona(
    options: GeneratePersonaOptions,
  ): AsyncGenerator<string> {
    const { displayName, roleTitle, existingPersona, prompt, jobDescription } =
      options;

    // Build a rich system prompt
    const systemPrompt = [
      'You are a creative writer specialising in vivid, personality-rich AI staff personas.',
      'Your output will be used verbatim as the "persona" field for an AI assistant.',
      '',
      'Rules:',
      '• Write in second person ("You are …") or third person ("Alex is …") — be consistent.',
      '• Include: core personality traits, communication style, work habits, and at least one quirk.',
      '• Do NOT write a dry job description — focus on character, not duties.',
      '• Keep the persona to 150–300 words.',
      '• Output ONLY the persona text, no headings or meta-commentary.',
    ].join('\n');

    // Build the user message
    const contextParts: string[] = [];

    if (displayName) {
      contextParts.push(`Name: ${displayName}`);
    }
    if (roleTitle) {
      contextParts.push(`Role: ${roleTitle}`);
    }
    if (jobDescription) {
      contextParts.push(`Job Description: ${jobDescription}`);
    }

    let userMessage: string;

    if (existingPersona) {
      userMessage = [
        contextParts.length > 0 ? `Context:\n${contextParts.join('\n')}\n` : '',
        'Existing persona (expand and refine — do NOT start over):',
        existingPersona,
        '',
        prompt
          ? `Additional guidance (highest priority): ${prompt}`
          : 'Expand this persona with richer detail, more personality traits, and a memorable quirk.',
      ]
        .filter(Boolean)
        .join('\n');
    } else {
      userMessage = [
        contextParts.length > 0 ? `Context:\n${contextParts.join('\n')}\n` : '',
        prompt
          ? `Instructions: ${prompt}`
          : 'Generate a compelling, personality-rich persona for this AI staff member.',
      ]
        .filter(Boolean)
        .join('\n');
    }

    this.logger.log(
      `Generating persona stream for displayName="${displayName ?? ''}", roleTitle="${roleTitle ?? ''}"`,
    );

    const llm = await this.createLlmProvider(
      options.tenantId,
      options.installedApplicationId,
    );

    const result = streamText({
      model: llm('anthropic/claude-sonnet-4-6'),
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      temperature: 0.9,
      maxOutputTokens: 1024,
    });

    for await (const chunk of result.textStream) {
      yield chunk;
    }
  }

  /**
   * Generate an avatar for a staff member.
   *
   * Maps the requested style to a prompt template and combines it with staff
   * info context.  Returns a placeholder URL until a real image generation API
   * is integrated.
   */
  generateAvatar(options: GenerateAvatarOptions): { avatarUrl: string } {
    // TODO: Integrate with image generation API (e.g., DALL-E, Midjourney API)
    // For now return a placeholder based on style
    const stylePrompts: Record<string, string> = {
      realistic: 'Professional photorealistic portrait',
      cartoon: 'Colorful cartoon illustration portrait',
      anime: 'Anime style character portrait',
      'notion-lineart': 'Minimalist black and white line art portrait',
    };

    const basePrompt = stylePrompts[options.style] ?? stylePrompts['realistic'];
    // Build full prompt combining style + context
    const parts = [basePrompt];
    if (options.displayName) parts.push(`of ${options.displayName}`);
    if (options.roleTitle) parts.push(`working as ${options.roleTitle}`);
    if (options.prompt) parts.push(options.prompt);

    this.logger.log(`Avatar generation prompt: ${parts.join(', ')}`);

    // Placeholder until image generation API is integrated
    return {
      avatarUrl: `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(options.displayName ?? 'staff')}`,
    };
  }

  /**
   * Stream 3 diverse AI employee candidate role cards via SSE.
   *
   * Uses Vercel AI SDK's streamText with Output.object and a Zod schema to generate and
   * stream structured candidate profiles.
   */
  async *generateCandidates(
    tenantId: string,
    installedApplicationId: string,
    dto: GenerateCandidatesDto,
  ): AsyncGenerator<{ type: 'partial' | 'complete'; data: unknown }> {
    const promptParts: string[] = [
      'Generate exactly 3 diverse AI employee candidate profiles.',
      'Each candidate should be unique and interesting with distinct personality traits.',
      'The persona should be personality-rich: include character traits, communication style, work habits, and quirks.',
      "Each summary should be 1-2 sentences capturing the candidate's essence.",
    ];

    if (dto.jobTitle) promptParts.push(`Job Title: ${dto.jobTitle}`);
    if (dto.jobDescription)
      promptParts.push(`Job Description: ${dto.jobDescription}`);

    const llm = await this.createLlmProvider(tenantId, installedApplicationId);

    const result = streamText({
      model: llm('anthropic/claude-sonnet-4-6'),
      output: Output.object({ schema: candidateSchema }),
      prompt: promptParts.join('\n'),
      temperature: 0.95,
    });

    for await (const partial of result.partialOutputStream) {
      yield { type: 'partial' as const, data: partial };
    }

    const final = await result.output;
    yield { type: 'complete' as const, data: final };
  }
}
