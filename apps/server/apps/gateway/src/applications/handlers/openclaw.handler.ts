import { Injectable, Inject, Logger } from '@nestjs/common';
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
  ) {}

  async onInstall(context: InstallContext): Promise<InstallResult> {
    const { installedApplication, tenantId, installedBy } = context;

    // 1. Create bot with token (installer becomes mentor)
    const { bot, accessToken } = await this.botService.createWorkspaceBot({
      ownerId: installedBy,
      tenantId,
      displayName: 'OpenClaw Bot',
      installedApplicationId: installedApplication.id,
      generateToken: true,
      mentorId: installedBy,
    });

    // 2. Create OpenClaw compute instance
    const instancesId = bot.botId;

    const instanceResult = await this.openclawService.createInstance(
      instancesId,
      instancesId, // subdomain
      {
        TEAM9_TOKEN: accessToken!,
        TEAM9_BASE_URL: env.API_URL,
        CAPABILITY_BASE_URL: env.CAPABILITY_BASE_URL,
      },
    );

    if (instanceResult) {
      this.logger.log(
        `Created OpenClaw instance for bot ${bot.botId}: ${instanceResult.access_url}`,
      );
    }

    // 3. Return updated config/secrets
    return {
      config: {
        instancesId,
      },
      secrets: {
        instanceResult,
      },
      botId: bot.botId,
    };
  }

  async onUninstall(app: schema.InstalledApplication): Promise<void> {
    // Delete OpenClaw instance (cleans up all agents on control plane)
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

    // Clean up ALL bots linked to this application
    const bots = await this.db
      .select({ id: schema.bots.id })
      .from(schema.bots)
      .where(eq(schema.bots.installedApplicationId, app.id));

    for (const bot of bots) {
      try {
        await this.botService.deleteBotAndCleanup(bot.id);
      } catch (error) {
        this.logger.warn(`Failed to clean up bot ${bot.id}:`, error);
      }
    }
  }
}
