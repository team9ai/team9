import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { BotExtra } from '@team9/database/schemas';
import { ClawHiveService } from '@team9/claw-hive';
import { AiClientService, AIProvider } from '@team9/ai-client';
import { BotService } from '../bot/bot.service.js';
import { ChannelsService } from '../im/channels/channels.service.js';
import { InstalledApplicationsService } from './installed-applications.service.js';
import type {
  CreateCommonStaffDto,
  UpdateCommonStaffDto,
} from './dto/common-staff.dto.js';
import type {
  GeneratePersonaDto,
  GenerateAvatarDto,
  GenerateCandidatesDto,
} from './dto/generate-persona.dto.js';

export interface CommonStaffResult {
  botId: string;
  userId: string;
  agentId: string;
  displayName: string;
}

const COMMON_STAFF_APPLICATION_ID = 'common-staff';
const HIVE_BLUEPRINT_ID = 'team9-common-staff';

@Injectable()
export class CommonStaffService {
  private readonly logger = new Logger(CommonStaffService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly botService: BotService,
    private readonly clawHiveService: ClawHiveService,
    private readonly channelsService: ChannelsService,
    private readonly installedApplicationsService: InstalledApplicationsService,
    private readonly aiClientService: AiClientService,
  ) {}

  /**
   * Create a new common-staff bot for a workspace.
   *
   * Steps:
   * 1. Verify the installed application is common-staff type
   * 2. Auto-generate display name if agenticBootstrap is set and none provided
   * 3. Create bot via BotService with managedProvider=hive
   * 4. Set managedMeta.agentId = "common-staff-{botId}"
   * 5. Set BotExtra.commonStaff via updateBotExtra
   * 6. Register agent with claw-hive
   * 7. Create DM channels for all workspace members
   * 8. If agenticBootstrap, trigger a claw-hive session in the mentor DM
   */
  async createStaff(
    installedApplicationId: string,
    tenantId: string,
    ownerId: string,
    dto: CreateCommonStaffDto,
  ): Promise<CommonStaffResult> {
    // 1. Verify app is common-staff type
    const app = await this.installedApplicationsService.findById(
      installedApplicationId,
      tenantId,
    );
    if (!app) {
      throw new NotFoundException(
        `Installed application ${installedApplicationId} not found`,
      );
    }
    if (app.applicationId !== COMMON_STAFF_APPLICATION_ID) {
      throw new BadRequestException(
        `Application ${installedApplicationId} is not a common-staff application`,
      );
    }

    // 2. Auto-generate temporary display name for agentic bootstrap
    if (dto.agenticBootstrap && !dto.displayName) {
      const existingBots =
        await this.botService.getBotsByInstalledApplicationId(
          installedApplicationId,
        );
      dto.displayName = `Candidate #${existingBots.length + 1}`;
    }

    // 3. Create bot with managedProvider=hive
    const { bot, accessToken } = await this.botService.createWorkspaceBot({
      ownerId,
      tenantId,
      displayName: dto.displayName,
      type: 'system',
      installedApplicationId,
      generateToken: true,
      mentorId: dto.mentorId,
      managedProvider: 'hive',
    });

    const agentId = `common-staff-${bot.botId}`;

    try {
      // 4. Update managedMeta with agentId
      await this.db
        .update(schema.bots)
        .set({
          managedMeta: { agentId },
          updatedAt: new Date(),
        })
        .where(eq(schema.bots.id, bot.botId));

      // Update avatar if provided
      if (dto.avatarUrl !== undefined) {
        await this.db
          .update(schema.users)
          .set({ avatarUrl: dto.avatarUrl, updatedAt: new Date() })
          .where(eq(schema.users.id, bot.userId));
      }

      // 5. Set BotExtra.commonStaff
      const extra: BotExtra = {
        commonStaff: {
          roleTitle: dto.roleTitle,
          persona: dto.persona,
          jobDescription: dto.jobDescription,
          model: dto.model,
        },
      };
      await this.botService.updateBotExtra(bot.botId, extra);

      // 6. Register agent with claw-hive
      await this.clawHiveService.registerAgent({
        id: agentId,
        name: dto.displayName,
        blueprintId: HIVE_BLUEPRINT_ID,
        tenantId,
        metadata: {
          tenantId,
          botId: bot.botId,
          mentorId: dto.mentorId ?? null,
        },
        model: dto.model,
        componentConfigs: {
          'system-prompt': { prompt: 'You are a helpful AI assistant.' },
          team9: {
            team9AuthToken: accessToken!,
            botUserId: bot.userId,
            team9BaseUrl: process.env.API_URL || '',
          },
          'team9-staff-profile': {},
          'team9-staff-bootstrap': {},
          'team9-staff-soul': {},
        },
      });

      this.logger.log(
        `Registered claw-hive agent ${agentId} for bot ${bot.botId}`,
      );

      // 7. Create DM channels for workspace members
      const members = await this.db
        .select({ userId: schema.tenantMembers.userId })
        .from(schema.tenantMembers)
        .where(eq(schema.tenantMembers.tenantId, tenantId));

      const memberUserIds = members
        .map((m) => m.userId)
        .filter((uid) => uid !== bot.userId);

      let dmChannelMap: Map<string, { id: string }> = new Map();
      if (memberUserIds.length > 0) {
        dmChannelMap = await this.channelsService.createDirectChannelsBatch(
          bot.userId,
          memberUserIds,
          tenantId,
        );
        this.logger.log(
          `Created DM channels for bot ${bot.botId} with ${memberUserIds.length} members`,
        );
      }

      // 8. Trigger bootstrap session in mentor DM if agenticBootstrap is set
      // Fall back to ownerId when mentorId is not explicitly provided
      const effectiveMentorId = dto.mentorId ?? ownerId;
      if (dto.agenticBootstrap && effectiveMentorId) {
        const mentorDmChannel = dmChannelMap.get(effectiveMentorId);
        if (mentorDmChannel) {
          try {
            await this.clawHiveService.createSession(
              agentId,
              {
                userId: effectiveMentorId,
                team9Context: {
                  source: 'team9',
                  scopeType: 'dm',
                  scopeId: mentorDmChannel.id,
                  peerUserId: effectiveMentorId,
                  isMentorDm: true,
                },
              },
              tenantId,
            );
            this.logger.log(
              `Triggered bootstrap session for agent ${agentId} in mentor DM channel ${mentorDmChannel.id}`,
            );
          } catch (bootstrapError) {
            // Non-fatal: log warning but don't fail the entire creation
            this.logger.warn(
              `Failed to trigger bootstrap session for agent ${agentId}, continuing`,
              bootstrapError,
            );
          }
        } else {
          this.logger.warn(
            `agenticBootstrap set but no DM channel found for mentor ${effectiveMentorId} — skipping bootstrap`,
          );
        }
      }
    } catch (error) {
      // Rollback: clean up bot
      this.logger.error(
        `Failed to create common-staff bot, rolling back bot ${bot.botId}`,
        error,
      );
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
      displayName: dto.displayName,
    };
  }

  /**
   * Update an existing common-staff bot.
   *
   * Steps:
   * 1. Verify installed application is common-staff type
   * 2. Verify bot belongs to this installed application
   * 3. Update bot display name, mentor, avatar as needed
   * 4. Update BotExtra.commonStaff (merge with existing)
   * 5. Sync to claw-hive
   */
  async updateStaff(
    installedApplicationId: string,
    tenantId: string,
    botId: string,
    dto: UpdateCommonStaffDto,
  ): Promise<void> {
    // 1. Verify app is common-staff type
    const app = await this.installedApplicationsService.findById(
      installedApplicationId,
      tenantId,
    );
    if (!app) {
      throw new NotFoundException(
        `Installed application ${installedApplicationId} not found`,
      );
    }
    if (app.applicationId !== COMMON_STAFF_APPLICATION_ID) {
      throw new BadRequestException(
        `Application ${installedApplicationId} is not a common-staff application`,
      );
    }

    // 2. Verify bot belongs to this installed application
    const bot = await this.botService.getBotById(botId);
    if (!bot) {
      throw new NotFoundException(`Bot ${botId} not found`);
    }

    // Check bot belongs to the installed application via DB query
    const botRecords = await this.db
      .select({
        installedApplicationId: schema.bots.installedApplicationId,
      })
      .from(schema.bots)
      .where(
        and(
          eq(schema.bots.id, botId),
          eq(schema.bots.installedApplicationId, installedApplicationId),
        ),
      );

    if (botRecords.length === 0) {
      throw new BadRequestException(
        `Bot ${botId} does not belong to installed application ${installedApplicationId}`,
      );
    }

    // 3. Update display name, mentor, avatar
    if (dto.displayName !== undefined) {
      await this.botService.updateBotDisplayName(botId, dto.displayName);
    }

    if (dto.mentorId !== undefined) {
      await this.botService.updateBotMentor(botId, dto.mentorId || null);
    }

    if (dto.avatarUrl !== undefined) {
      await this.db
        .update(schema.users)
        .set({ avatarUrl: dto.avatarUrl, updatedAt: new Date() })
        .where(eq(schema.users.id, bot.userId));
    }

    // 4. Update BotExtra.commonStaff (merge with existing)
    const existingExtra = (bot.extra as BotExtra) ?? {};
    const existingCommonStaff = existingExtra.commonStaff ?? {};
    const updatedExtra: BotExtra = {
      ...existingExtra,
      commonStaff: {
        ...existingCommonStaff,
        ...(dto.roleTitle !== undefined ? { roleTitle: dto.roleTitle } : {}),
        ...(dto.persona !== undefined ? { persona: dto.persona } : {}),
        ...(dto.jobDescription !== undefined
          ? { jobDescription: dto.jobDescription }
          : {}),
        ...(dto.model !== undefined ? { model: dto.model } : {}),
      },
    };
    await this.botService.updateBotExtra(botId, updatedExtra);

    // 5. Sync to claw-hive
    const agentId = `common-staff-${botId}`;

    await this.clawHiveService.updateAgent(agentId, {
      tenantId,
      metadata: {
        tenantId,
        botId,
      },
      ...(dto.displayName !== undefined ? { name: dto.displayName } : {}),
      ...(dto.model !== undefined ? { model: dto.model } : {}),
    });

    this.logger.log(`Updated claw-hive agent ${agentId} for bot ${botId}`);
  }

  /**
   * Delete a common-staff bot.
   *
   * Steps:
   * 1. Verify installed application is common-staff type
   * 2. Delete claw-hive agent
   * 3. Delete bot and cleanup
   */
  async deleteStaff(
    installedApplicationId: string,
    tenantId: string,
    botId: string,
  ): Promise<void> {
    // 1. Verify app is common-staff type
    const app = await this.installedApplicationsService.findById(
      installedApplicationId,
      tenantId,
    );
    if (!app) {
      throw new NotFoundException(
        `Installed application ${installedApplicationId} not found`,
      );
    }
    if (app.applicationId !== COMMON_STAFF_APPLICATION_ID) {
      throw new BadRequestException(
        `Application ${installedApplicationId} is not a common-staff application`,
      );
    }

    // 2. Verify bot belongs to this installed application
    const bot = await this.botService.getBotById(botId);
    if (!bot) {
      throw new NotFoundException(`Bot ${botId} not found`);
    }
    // Check the bot belongs to this installed application
    const botRecords = await this.db
      .select({
        installedApplicationId: schema.bots.installedApplicationId,
      })
      .from(schema.bots)
      .where(
        and(
          eq(schema.bots.id, botId),
          eq(schema.bots.installedApplicationId, installedApplicationId),
        ),
      );

    if (botRecords.length === 0) {
      throw new BadRequestException(
        `Bot ${botId} does not belong to installed application ${installedApplicationId}`,
      );
    }

    // 4. Delete claw-hive agent first
    const agentId = `common-staff-${botId}`;
    try {
      await this.clawHiveService.deleteAgent(agentId);
      this.logger.log(`Deleted claw-hive agent ${agentId}`);
    } catch (error) {
      this.logger.warn(
        `Failed to delete claw-hive agent ${agentId}, continuing with bot cleanup`,
        error,
      );
    }

    // 5. Delete bot and cleanup
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
    appId: string,
    tenantId: string,
    dto: GeneratePersonaDto,
  ): AsyncGenerator<string> {
    // Verify app is common-staff type
    const app = await this.installedApplicationsService.findById(
      appId,
      tenantId,
    );
    if (!app || app.applicationId !== COMMON_STAFF_APPLICATION_ID) {
      throw new BadRequestException('Not a common-staff application');
    }

    const { displayName, roleTitle, existingPersona, prompt } = dto;

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

    const stream = this.aiClientService.chat({
      provider: AIProvider.CLAUDE,
      model: 'claude-3-5-haiku-20241022',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.9,
      maxTokens: 1024,
      stream: true,
    });

    for await (const chunk of stream) {
      yield chunk;
    }
  }

  /**
   * Generate an avatar for a common-staff member.
   *
   * Maps the requested style to a prompt template and combines it with staff
   * info context.  Returns a placeholder URL until a real image generation API
   * is integrated.
   */
  async generateAvatar(
    appId: string,
    tenantId: string,
    dto: GenerateAvatarDto,
  ): Promise<{ avatarUrl: string }> {
    // Verify app is common-staff type
    const app = await this.installedApplicationsService.findById(
      appId,
      tenantId,
    );
    if (!app || app.applicationId !== COMMON_STAFF_APPLICATION_ID) {
      throw new BadRequestException('Not a common-staff application');
    }

    // TODO: Integrate with image generation API (e.g., DALL-E, Midjourney API)
    // For now return a placeholder based on style
    const stylePrompts: Record<string, string> = {
      realistic: 'Professional photorealistic portrait',
      cartoon: 'Colorful cartoon illustration portrait',
      anime: 'Anime style character portrait',
      'notion-lineart': 'Minimalist black and white line art portrait',
    };

    const basePrompt = stylePrompts[dto.style] ?? stylePrompts['realistic'];
    // Build full prompt combining style + context
    const parts = [basePrompt];
    if (dto.displayName) parts.push(`of ${dto.displayName}`);
    if (dto.roleTitle) parts.push(`working as ${dto.roleTitle}`);
    if (dto.prompt) parts.push(dto.prompt);

    this.logger.log(`Avatar generation prompt: ${parts.join(', ')}`);

    // Placeholder until image generation API is integrated
    return {
      avatarUrl: `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(dto.displayName ?? 'staff')}`,
    };
  }

  /**
   * Stream 3 diverse AI employee candidate role cards via SSE.
   *
   * Builds a prompt to generate 3 diverse candidate profiles and streams
   * structured JSON objects for each candidate as they are parsed from the
   * AI response.
   */
  async *generateCandidates(
    appId: string,
    tenantId: string,
    dto: GenerateCandidatesDto,
  ): AsyncGenerator<{ type: 'candidate' | 'partial'; data: unknown }> {
    // Verify app is common-staff type
    const app = await this.installedApplicationsService.findById(
      appId,
      tenantId,
    );
    if (!app || app.applicationId !== COMMON_STAFF_APPLICATION_ID) {
      throw new BadRequestException('Not a common-staff application');
    }

    // Build prompt for 3 candidates
    const systemPrompt = `You are a creative HR consultant. Generate exactly 3 diverse AI employee candidate profiles.
Each candidate should be unique and interesting with distinct personality traits.

Output EXACTLY 3 candidates as JSON objects, one per line, in this format:
{"candidateIndex": 1, "displayName": "...", "roleTitle": "...", "persona": "...", "summary": "..."}
{"candidateIndex": 2, "displayName": "...", "roleTitle": "...", "persona": "...", "summary": "..."}
{"candidateIndex": 3, "displayName": "...", "roleTitle": "...", "persona": "...", "summary": "..."}

The persona should be personality-rich: include character traits, communication style, work habits, and quirks.
Each summary should be 1-2 sentences capturing the candidate's essence.`;

    const userMessageParts: string[] = [];
    if (dto.jobTitle) userMessageParts.push(`Job Title: ${dto.jobTitle}`);
    if (dto.jobDescription)
      userMessageParts.push(`Job Description: ${dto.jobDescription}`);
    if (userMessageParts.length === 0)
      userMessageParts.push('Generate 3 diverse AI employee candidates.');

    // Stream from AI
    const stream = this.aiClientService.chat({
      provider: AIProvider.CLAUDE,
      model: 'claude-3-5-haiku-20241022',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessageParts.join('\n') },
      ],
      stream: true,
      temperature: 0.95,
    });

    // Accumulate and parse JSON lines
    let buffer = '';
    for await (const chunk of stream) {
      buffer += chunk;
      // Try to parse complete JSON lines
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const candidate = JSON.parse(trimmed) as Record<string, unknown>;
          if (candidate['candidateIndex']) {
            yield { type: 'candidate', data: candidate };
          }
        } catch {
          // Partial JSON, yield as partial text
          yield { type: 'partial', data: { text: trimmed } };
        }
      }
    }
    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const candidate = JSON.parse(buffer.trim()) as Record<string, unknown>;
        if (candidate['candidateIndex']) {
          yield { type: 'candidate', data: candidate };
        }
      } catch {
        yield { type: 'partial', data: { text: buffer.trim() } };
      }
    }
  }
}
