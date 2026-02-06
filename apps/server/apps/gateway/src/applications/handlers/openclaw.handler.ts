import { Injectable, Inject, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { env } from '@team9/shared';
import type {
  ApplicationHandler,
  InstallContext,
  InstallResult,
} from './application-handler.interface.js';
import { BotService } from '../../bot/bot.service.js';
import { OpenclawService } from '../../openclaw/openclaw.service.js';
import { ChannelsService } from '../../im/channels/channels.service.js';

/**
 * Handler for OpenClaw application installation.
 *
 * When OpenClaw is installed for a tenant, this handler:
 * 1. Creates a bot user and bot record
 * 2. Generates an access token for the bot
 * 3. Creates an OpenClaw compute instance
 * 4. Adds the bot to the workspace
 * 5. Creates a DM channel between the installer and the bot
 */
@Injectable()
export class OpenClawHandler implements ApplicationHandler {
  readonly applicationId = 'openclaw';
  private readonly logger = new Logger(OpenClawHandler.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly botService: BotService,
    private readonly openclawService: OpenclawService,
    private readonly channelsService: ChannelsService,
  ) {}

  async onInstall(context: InstallContext): Promise<InstallResult> {
    const { installedApplication, tenantId, installedBy } = context;

    // 1. Get installer info for bot naming
    const [installer] = await this.db
      .select({
        username: schema.users.username,
      })
      .from(schema.users)
      .where(eq(schema.users.id, installedBy))
      .limit(1);

    if (!installer) {
      throw new Error(`Installer user ${installedBy} not found`);
    }

    // 2. Create bot user and bot record
    const shortId = uuidv7().replace(/-/g, '').slice(0, 8);
    const botUsername = `bot_${shortId}_${Date.now()}`;

    const bot = await this.botService.createBot({
      username: botUsername,
      displayName: 'OpenClaw Bot',
      type: 'custom',
      ownerId: installedBy,
      description: `OpenClaw bot for ${installer.username}`,
      capabilities: { canSendMessages: true, canReadMessages: true },
    });

    this.logger.log(
      `Created bot ${bot.botId} for OpenClaw installation ${installedApplication.id}`,
    );

    // 3. Link bot to installed application
    await this.db
      .update(schema.bots)
      .set({
        installedApplicationId: installedApplication.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.bots.id, bot.botId));

    // 4. Generate access token
    const tokenResult = await this.botService.generateAccessToken(bot.botId);

    // 5. Add bot to workspace as a member
    await this.db.insert(schema.tenantMembers).values({
      id: uuidv7(),
      tenantId,
      userId: bot.userId,
      role: 'member',
      invitedBy: installedBy,
    });
    this.logger.log(`Added bot ${bot.botId} to workspace ${tenantId}`);

    // 6. Create a direct channel so the installer can see the bot
    await this.channelsService.createDirectChannel(
      installedBy,
      bot.userId,
      tenantId,
    );
    this.logger.log(`Created DM channel for bot ${bot.botId}`);

    // 7. Create OpenClaw compute instance
    // Use bot.botId as instancesId (this is the new convention)
    const instancesId = bot.botId;

    const instanceResult = await this.openclawService.createInstance(
      instancesId,
      instancesId, // subdomain
      {
        TEAM9_TOKEN: tokenResult.accessToken,
        TEAM9_BASE_URL: env.API_URL,
      },
    );

    if (instanceResult) {
      this.logger.log(
        `Created OpenClaw instance for bot ${bot.botId}: ${instanceResult.access_url}`,
      );
    }

    // 8. Return updated config/secrets
    return {
      config: {
        instancesId,
      },
      secrets: {
        accessToken: tokenResult.accessToken,
        instanceResult,
      },
      botId: bot.botId,
    };
  }

  async onUninstall(app: schema.InstalledApplication): Promise<void> {
    // Get the linked bot
    const [bot] = await this.db
      .select({ id: schema.bots.id, userId: schema.bots.userId })
      .from(schema.bots)
      .where(eq(schema.bots.installedApplicationId, app.id))
      .limit(1);

    if (!bot) {
      this.logger.warn(`No bot found for application ${app.id}`);
      return;
    }

    // Delete OpenClaw instance
    const instancesId = (app.config as { instancesId?: string })?.instancesId;
    if (instancesId) {
      try {
        await this.openclawService.deleteInstance(instancesId);
        this.logger.log(`Deleted OpenClaw instance ${instancesId}`);
      } catch (error) {
        this.logger.warn(
          `Failed to delete OpenClaw instance ${instancesId}:`,
          error,
        );
      }
    }

    // Note: Bot and related records will be cleaned up by FK cascade
    // when the installed application is deleted
  }
}
