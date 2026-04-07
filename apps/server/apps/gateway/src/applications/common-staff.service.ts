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
import { BotService } from '../bot/bot.service.js';
import { ChannelsService } from '../im/channels/channels.service.js';
import { InstalledApplicationsService } from './installed-applications.service.js';
import { StaffService, type StaffBotResult } from './staff.service.js';
import type {
  CreateCommonStaffDto,
  UpdateCommonStaffDto,
} from './dto/common-staff.dto.js';
import type {
  GeneratePersonaDto,
  GenerateAvatarDto,
  GenerateCandidatesDto,
} from './dto/generate-persona.dto.js';

export type { StaffBotResult as CommonStaffResult };

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
    private readonly staffService: StaffService,
  ) {}

  /**
   * Create a new common-staff bot for a workspace.
   *
   * Steps:
   * 1. Verify the installed application is common-staff type
   * 2. Auto-generate display name if agenticBootstrap is set and none provided
   * 3. Create bot + register claw-hive agent via StaffService
   * 4. Create DM channels for all workspace members
   * 5. If agenticBootstrap, trigger a claw-hive session in the mentor DM
   */
  async createStaff(
    installedApplicationId: string,
    tenantId: string,
    ownerId: string,
    dto: CreateCommonStaffDto,
  ): Promise<StaffBotResult> {
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
    let effectiveDisplayName: string = dto.displayName ?? 'New Staff';
    if (dto.agenticBootstrap && !dto.displayName) {
      const existingBots =
        await this.botService.getBotsByInstalledApplicationId(
          installedApplicationId,
        );
      effectiveDisplayName = `Candidate #${existingBots.length + 1}`;
    }

    // Default mentorId to the creating user if not provided
    const effectiveMentorId = dto.mentorId || ownerId;

    // Validate mentor is a workspace member
    const mentorMember = await this.db
      .select({ userId: schema.tenantMembers.userId })
      .from(schema.tenantMembers)
      .where(
        and(
          eq(schema.tenantMembers.tenantId, tenantId),
          eq(schema.tenantMembers.userId, effectiveMentorId),
        ),
      )
      .limit(1);

    if (mentorMember.length === 0) {
      throw new BadRequestException(
        `Mentor ${effectiveMentorId} is not a member of this workspace`,
      );
    }

    // 3. Create bot + register agent via StaffService
    const extra: BotExtra = {
      commonStaff: {
        roleTitle: dto.roleTitle,
        persona: dto.persona,
        jobDescription: dto.jobDescription,
        model: dto.model,
      },
    };

    const result = await this.staffService.createBotWithAgent({
      agentIdPrefix: 'common-staff',
      blueprintId: HIVE_BLUEPRINT_ID,
      ownerId,
      tenantId,
      displayName: effectiveDisplayName,
      installedApplicationId,
      mentorId: effectiveMentorId,
      avatarUrl: dto.avatarUrl,
      model: dto.model,
      botExtra: extra,
      extraComponentConfigs: {
        'team9-staff-profile': {},
        'team9-staff-bootstrap': {},
        'team9-staff-soul': {},
      },
    });

    // 4. Create DM channels for workspace members
    const members = await this.db
      .select({ userId: schema.tenantMembers.userId })
      .from(schema.tenantMembers)
      .where(eq(schema.tenantMembers.tenantId, tenantId));

    const memberUserIds = members
      .map((m) => m.userId)
      .filter((uid) => uid !== result.userId);

    let dmChannelMap: Map<string, { id: string }> = new Map();
    if (memberUserIds.length > 0) {
      dmChannelMap = await this.channelsService.createDirectChannelsBatch(
        result.userId,
        memberUserIds,
        tenantId,
      );
      this.logger.log(
        `Created DM channels for bot ${result.botId} with ${memberUserIds.length} members`,
      );
    }

    // 5. Trigger bootstrap session in mentor DM if agenticBootstrap is set
    if (dto.agenticBootstrap && effectiveMentorId) {
      const mentorDmChannel = dmChannelMap.get(effectiveMentorId);
      if (mentorDmChannel) {
        try {
          const sessionId = `team9/${tenantId}/${result.agentId}/dm/${mentorDmChannel.id}`;
          await this.clawHiveService.sendInput(
            sessionId,
            {
              type: 'team9:bootstrap.start',
              source: 'team9',
              timestamp: new Date().toISOString(),
              payload: {
                mentorId: effectiveMentorId,
                isMentorDm: true,
                channelId: mentorDmChannel.id,
              },
            },
            tenantId,
          );
          this.logger.log(
            `Triggered bootstrap session for agent ${result.agentId} in mentor DM channel ${mentorDmChannel.id}`,
          );
        } catch (bootstrapError) {
          // Non-fatal: log warning but don't fail the entire creation
          this.logger.warn(
            `Failed to trigger bootstrap session for agent ${result.agentId}, continuing`,
            bootstrapError,
          );
        }
      } else {
        this.logger.warn(
          `agenticBootstrap set but no DM channel found for mentor ${effectiveMentorId} — skipping bootstrap`,
        );
      }
    }

    return {
      botId: result.botId,
      userId: result.userId,
      agentId: result.agentId,
      displayName: effectiveDisplayName,
    };
  }

  /**
   * Update an existing common-staff bot.
   *
   * Steps:
   * 1. Verify installed application is common-staff type
   * 2. Verify bot belongs to this installed application
   * 3. Update bot + sync to claw-hive via StaffService
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

    // Validate mentor is a workspace member (only when a non-empty mentorId is provided)
    if (dto.mentorId !== undefined && dto.mentorId) {
      const mentorMember = await this.db
        .select({ userId: schema.tenantMembers.userId })
        .from(schema.tenantMembers)
        .where(
          and(
            eq(schema.tenantMembers.tenantId, tenantId),
            eq(schema.tenantMembers.userId, dto.mentorId),
          ),
        )
        .limit(1);

      if (mentorMember.length === 0) {
        throw new BadRequestException(
          `Mentor ${dto.mentorId} is not a member of this workspace`,
        );
      }
    }

    // 3. Build merged BotExtra and delegate to StaffService
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

    await this.staffService.updateBotAndAgent({
      agentIdPrefix: 'common-staff',
      botId,
      botUserId: bot.userId,
      tenantId,
      displayName: dto.displayName,
      mentorId: dto.mentorId,
      avatarUrl: dto.avatarUrl,
      model: dto.model,
      botExtra: updatedExtra,
      currentMentorId: bot.mentorId ?? null,
    });
  }

  /**
   * Delete a common-staff bot.
   *
   * Steps:
   * 1. Verify installed application is common-staff type
   * 2. Verify bot belongs to this installed application
   * 3. Delete bot + agent via StaffService
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

    // 3. Delete bot + agent via StaffService
    await this.staffService.deleteBotAndAgent({
      agentIdPrefix: 'common-staff',
      botId,
    });
  }

  /**
   * Generate a personality-rich persona via streaming AI response.
   *
   * Delegates to StaffService.generatePersona after verifying the app type.
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

    yield* this.staffService.generatePersona({
      displayName: dto.displayName,
      roleTitle: dto.roleTitle,
      existingPersona: dto.existingPersona,
      prompt: dto.prompt,
      jobDescription: dto.jobDescription,
    });
  }

  /**
   * Generate an avatar for a common-staff member.
   *
   * Delegates to StaffService.generateAvatar after verifying the app type.
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

    return this.staffService.generateAvatar({
      style: dto.style,
      displayName: dto.displayName,
      roleTitle: dto.roleTitle,
      persona: dto.persona,
      prompt: dto.prompt,
    });
  }

  /**
   * Stream 3 diverse AI employee candidate role cards via SSE.
   *
   * Delegates to StaffService.generateCandidates after verifying the app type.
   */
  async *generateCandidates(
    appId: string,
    tenantId: string,
    dto: GenerateCandidatesDto,
  ): AsyncGenerator<{ type: 'partial' | 'complete'; data: unknown }> {
    // Verify app is common-staff type
    const app = await this.installedApplicationsService.findById(
      appId,
      tenantId,
    );
    if (!app || app.applicationId !== COMMON_STAFF_APPLICATION_ID) {
      throw new BadRequestException('Not a common-staff application');
    }

    yield* this.staffService.generateCandidates(dto);
  }
}
