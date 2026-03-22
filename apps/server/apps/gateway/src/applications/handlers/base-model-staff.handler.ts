import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type {
  ApplicationHandler,
  InstallContext,
  InstallResult,
} from './application-handler.interface.js';
import { BotService } from '../../bot/bot.service.js';
import { ClawHiveService } from '@team9/claw-hive';
import { ChannelsService } from '../../im/channels/channels.service.js';
import { BASE_MODEL_PRESETS } from './base-model-staff.presets.js';

/**
 * Handler for Base Model Staff application installation.
 *
 * When installed for a tenant, this handler:
 * 1. Health-checks claw-hive API
 * 2. Creates 3 bots (Claude, ChatGPT, Gemini) with type=system, managedProvider=hive
 * 3. Registers corresponding agents in claw-hive
 * 4. Creates DM channels between each bot and all workspace members
 */
@Injectable()
export class BaseModelStaffHandler implements ApplicationHandler {
  readonly applicationId = 'base-model-staff';
  private readonly logger = new Logger(BaseModelStaffHandler.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly botService: BotService,
    private readonly clawHiveService: ClawHiveService,
    private readonly channelsService: ChannelsService,
  ) {}

  async onInstall(context: InstallContext): Promise<InstallResult> {
    const { installedApplication, tenantId, installedBy } = context;

    // 1. Health check
    const healthy = await this.clawHiveService.healthCheck();
    if (!healthy) {
      throw new Error('Claw Hive API is not reachable');
    }

    // 2. Get all workspace members for DM creation
    const members = await this.db
      .select({ userId: schema.tenantMembers.userId })
      .from(schema.tenantMembers)
      .where(eq(schema.tenantMembers.tenantId, tenantId));

    // 3. Create bots and register agents
    const createdBots: string[] = [];
    const botIds: string[] = [];

    try {
      for (const preset of BASE_MODEL_PRESETS) {
        // 3a. Create bot in team9
        const { bot, accessToken } = await this.botService.createWorkspaceBot({
          ownerId: installedBy,
          tenantId,
          type: 'system',
          displayName: preset.name,
          username: `${preset.key}-bot-${tenantId.slice(0, 8)}`,
          installedApplicationId: installedApplication.id,
          generateToken: true,
          mentorId: installedBy,
          managedProvider: 'hive',
          managedMeta: {
            agentId: `base-model-${preset.key}-${tenantId.slice(0, 8)}`,
          },
        });

        createdBots.push(bot.botId);
        botIds.push(bot.botId);

        this.logger.log(
          `Created bot ${bot.botId} (${preset.name}) for tenant ${tenantId}`,
        );

        // 3b. Register agent in claw-hive
        await this.clawHiveService.registerAgent({
          id: `base-model-${preset.key}-${tenantId.slice(0, 8)}`,
          name: preset.name,
          blueprintId: 'team9-hive-base-model',
          tenantId,
          model: { provider: preset.provider, id: preset.modelId },
          componentConfigs: {
            'base-model-agent': { modelName: preset.name },
            team9: {
              team9AuthToken: accessToken!,
              botUserId: bot.userId,
            },
          },
        });

        this.logger.log(
          `Registered claw-hive agent base-model-${preset.key}-${tenantId.slice(0, 8)} for tenant ${tenantId}`,
        );

        // 3c. Create DM channels for all workspace members
        const memberUserIds = members
          .map((m) => m.userId)
          .filter((uid) => uid !== bot.userId);

        if (memberUserIds.length > 0) {
          await this.channelsService.createDirectChannelsBatch(
            bot.userId,
            memberUserIds,
            tenantId,
          );
        }
      }
    } catch (error) {
      // Rollback: clean up any bots created before the failure
      this.logger.error(
        'Failed to install base model staff, rolling back',
        error,
      );
      for (const botId of createdBots) {
        try {
          await this.botService.deleteBotAndCleanup(botId);
        } catch (cleanupError) {
          this.logger.warn(
            `Failed to clean up bot ${botId} during rollback`,
            cleanupError,
          );
        }
      }
      throw error;
    }

    return {
      config: { botIds },
    };
  }

  async onUninstall(app: schema.InstalledApplication): Promise<void> {
    const bots = await this.botService.getBotsByInstalledApplicationId(app.id);

    for (const bot of bots) {
      // Use managedMeta to get agentId
      if (bot.managedMeta?.agentId) {
        try {
          await this.clawHiveService.deleteAgent(bot.managedMeta.agentId);
          this.logger.log(`Deleted claw-hive agent ${bot.managedMeta.agentId}`);
        } catch (error) {
          this.logger.warn(
            `Failed to delete claw-hive agent ${bot.managedMeta.agentId}`,
            error,
          );
        }
      }
      try {
        await this.botService.deleteBotAndCleanup(bot.botId);
        this.logger.log(`Deleted bot ${bot.botId}`);
      } catch (error) {
        this.logger.warn(`Failed to clean up bot ${bot.botId}`, error);
      }
    }
  }
}
