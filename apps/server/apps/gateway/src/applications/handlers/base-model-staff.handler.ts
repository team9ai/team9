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
import {
  ChannelsService,
  type ChannelResponse,
} from '../../im/channels/channels.service.js';
import { WebsocketGateway } from '../../im/websocket/websocket.gateway.js';
import { RedisService } from '@team9/redis';
import { WS_EVENTS } from '../../im/websocket/events/events.constants.js';
import { REDIS_KEYS } from '../../im/shared/constants/redis-keys.js';
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
    private readonly websocketGateway: WebsocketGateway,
    private readonly redisService: RedisService,
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
      // Step 1: Create bots sequentially (needs accessToken per bot)
      const createdBotData: Array<{
        bot: { botId: string; userId: string };
        accessToken: string;
        preset: (typeof BASE_MODEL_PRESETS)[number];
      }> = [];

      for (const preset of BASE_MODEL_PRESETS) {
        const { bot, accessToken } = await this.botService.createWorkspaceBot({
          ownerId: installedBy,
          tenantId,
          type: 'system',
          displayName: preset.name,
          username: `${preset.key}_bot_${tenantId}`,
          installedApplicationId: installedApplication.id,
          generateToken: true,
          mentorId: installedBy,
          managedProvider: 'hive',
          managedMeta: {
            agentId: `base-model-${preset.key}-${tenantId}`,
          },
        });

        createdBots.push(bot.botId);
        botIds.push(bot.botId);
        createdBotData.push({ bot, accessToken: accessToken!, preset });

        this.logger.log(
          `Created bot ${bot.botId} (${preset.name}) for tenant ${tenantId}`,
        );
      }

      // Step 2: Batch register all agents (1 HTTP call instead of 3)
      await this.clawHiveService.registerAgents({
        agents: createdBotData.map(({ bot, accessToken, preset }) => ({
          id: `base-model-${preset.key}-${tenantId}`,
          name: preset.name,
          blueprintId: 'team9-hive-base-model',
          tenantId,
          model: { provider: preset.provider, id: preset.modelId },
          componentConfigs: {
            'base-model-agent': { modelName: preset.name },
            team9: {
              team9AuthToken: accessToken,
              botUserId: bot.userId,
            },
          },
        })),
        atomic: true,
      });

      this.logger.log(
        `Batch registered ${createdBotData.length} claw-hive agents for tenant ${tenantId}`,
      );

      // Step 3: Parallel channel creation + WebSocket notifications
      const memberUserIds = members.map((m) => m.userId);

      const allDmChannelMaps = await Promise.all(
        createdBotData.map(({ bot }) => {
          const filteredMembers = memberUserIds.filter(
            (uid) => uid !== bot.userId,
          );
          if (filteredMembers.length > 0) {
            return this.channelsService.createDirectChannelsBatch(
              bot.userId,
              filteredMembers,
              tenantId,
            );
          }
          return Promise.resolve(new Map<string, ChannelResponse>());
        }),
      );

      // Notify online users about new DM channels
      try {
        const onlineUsersHash = await this.redisService.hgetall(
          REDIS_KEYS.ONLINE_USERS,
        );

        await Promise.allSettled(
          allDmChannelMaps.flatMap((dmChannels) =>
            dmChannels
              ? Array.from(dmChannels.entries()).flatMap(
                  ([otherUserId, dmChannel]) => {
                    const notifications: Promise<void>[] = [];
                    // Notify the workspace member about the new bot DM
                    if (otherUserId in onlineUsersHash) {
                      notifications.push(
                        this.websocketGateway.sendToUser(
                          otherUserId,
                          WS_EVENTS.CHANNEL.CREATED,
                          dmChannel,
                        ),
                      );
                    }
                    return notifications;
                  },
                )
              : [],
          ),
        );
      } catch (error) {
        // Don't fail installation if WebSocket notifications fail
        this.logger.warn(
          `Failed to send channel_created notifications: ${error instanceof Error ? error.message : error}`,
        );
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

    // Batch delete all agents
    const agentIds = bots
      .filter((bot) => bot.managedMeta?.agentId)

      .map((bot) => bot.managedMeta!.agentId as string);

    if (agentIds.length > 0) {
      try {
        await this.clawHiveService.deleteAgents(agentIds);
        this.logger.log(`Deleted ${agentIds.length} claw-hive agents`);
      } catch (error) {
        this.logger.warn(
          `Failed to delete claw-hive agents, continuing with bot cleanup`,
          error,
        );
      }
    }

    // Delete bots
    for (const bot of bots) {
      try {
        await this.botService.deleteBotAndCleanup(bot.botId);
        this.logger.log(`Deleted bot ${bot.botId}`);
      } catch (error) {
        this.logger.warn(`Failed to clean up bot ${bot.botId}`, error);
      }
    }
  }
}
