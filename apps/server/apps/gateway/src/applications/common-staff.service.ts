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
import type {
  CreateCommonStaffDto,
  UpdateCommonStaffDto,
} from './dto/common-staff.dto.js';

export interface CommonStaffResult {
  botId: string;
  userId: string;
  agentId: string;
  displayName: string;
}

const COMMON_STAFF_APPLICATION_ID = 'common-staff';
const HIVE_BLUEPRINT_ID = 'team9-hive-common-staff';

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
  ) {}

  /**
   * Create a new common-staff bot for a workspace.
   *
   * Steps:
   * 1. Verify the installed application is common-staff type
   * 2. Create bot via BotService with managedProvider=hive
   * 3. Set managedMeta.agentId = "common-staff-{botId}"
   * 4. Set BotExtra.commonStaff via updateBotExtra
   * 5. Register agent with claw-hive
   * 6. Create DM channels for all workspace members
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

    // 2. Create bot with managedProvider=hive
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
      // 3. Update managedMeta with agentId
      await this.db
        .update(schema.bots)
        .set({
          managedMeta: { agentId },
          ...(dto.avatarUrl !== undefined ? {} : {}),
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

      // 4. Set BotExtra.commonStaff
      const extra: BotExtra = {
        commonStaff: {
          roleTitle: dto.roleTitle,
          persona: dto.persona,
          jobDescription: dto.jobDescription,
          model: dto.model,
        },
      };
      await this.botService.updateBotExtra(bot.botId, extra);

      // 5. Register agent with claw-hive
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
          'common-staff-agent': {
            roleTitle: dto.roleTitle ?? null,
            persona: dto.persona ?? null,
            jobDescription: dto.jobDescription ?? null,
          },
          team9: {
            team9AuthToken: accessToken!,
            botUserId: bot.userId,
          },
        },
      });

      this.logger.log(
        `Registered claw-hive agent ${agentId} for bot ${bot.botId}`,
      );

      // 6. Create DM channels for workspace members
      const members = await this.db
        .select({ userId: schema.tenantMembers.userId })
        .from(schema.tenantMembers)
        .where(eq(schema.tenantMembers.tenantId, tenantId));

      const memberUserIds = members
        .map((m) => m.userId)
        .filter((uid) => uid !== bot.userId);

      if (memberUserIds.length > 0) {
        await this.channelsService.createDirectChannelsBatch(
          bot.userId,
          memberUserIds,
          tenantId,
        );
        this.logger.log(
          `Created DM channels for bot ${bot.botId} with ${memberUserIds.length} members`,
        );
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
    const currentBot = await this.botService.getBotById(botId);
    const currentExtra = (currentBot?.extra as BotExtra) ?? {};

    await this.clawHiveService.updateAgent(agentId, {
      tenantId,
      metadata: {
        tenantId,
        botId,
        mentorId:
          dto.mentorId !== undefined ? dto.mentorId || null : bot.mentorId,
      },
      ...(dto.displayName !== undefined ? { name: dto.displayName } : {}),
      ...(dto.model !== undefined ? { model: dto.model } : {}),
      componentConfigs: {
        'common-staff-agent': {
          roleTitle: currentExtra.commonStaff?.roleTitle ?? null,
          persona: currentExtra.commonStaff?.persona ?? null,
          jobDescription: currentExtra.commonStaff?.jobDescription ?? null,
        },
      },
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

    // 2. Delete claw-hive agent first
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

    // 3. Delete bot and cleanup
    await this.botService.deleteBotAndCleanup(botId);
    this.logger.log(`Deleted bot ${botId}`);
  }
}
