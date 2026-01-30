import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import * as bcrypt from 'bcrypt';
import {
  DATABASE_CONNECTION,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { BotCapabilities } from '@team9/database/schemas';
import { env } from '@team9/shared';

/**
 * BotService manages the system bot account (Moltbot).
 *
 * The bot is stored as two records:
 * - A shadow row in `im_users` (with user_type='bot') for FK compatibility
 * - An extension row in `im_bots` for bot-specific metadata
 *
 * The bot account is automatically created on startup if configured via environment variables.
 * This bot will be automatically added to all new workspaces so users can interact with it.
 */
@Injectable()
export class BotService implements OnModuleInit {
  private readonly logger = new Logger(BotService.name);
  private botUserId: string | null = null;

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (env.SYSTEM_BOT_ENABLED) {
      await this.initializeBot();
    } else {
      this.logger.log('System bot is disabled (SYSTEM_BOT_ENABLED != true)');
    }
  }

  /**
   * Initialize the system bot account.
   * Creates the bot if it doesn't exist, or retrieves its ID if it does.
   * Ensures both im_users (shadow) and im_bots (extension) records exist.
   */
  private async initializeBot(): Promise<void> {
    const email = env.SYSTEM_BOT_EMAIL;
    const username = env.SYSTEM_BOT_USERNAME;
    const password = env.SYSTEM_BOT_PASSWORD;
    const displayName = env.SYSTEM_BOT_DISPLAY_NAME;

    if (!email || !username || !password) {
      this.logger.warn(
        'System bot enabled but missing required config (SYSTEM_BOT_EMAIL, SYSTEM_BOT_USERNAME, SYSTEM_BOT_PASSWORD)',
      );
      return;
    }

    try {
      // Check if bot already exists in im_users
      const [existingBot] = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);

      if (existingBot) {
        this.botUserId = existingBot.id;

        // Ensure user row is correctly marked as bot
        await this.db
          .update(schema.users)
          .set({
            emailVerified: true,
            userType: 'bot',
            updatedAt: new Date(),
          })
          .where(eq(schema.users.id, existingBot.id));

        // Ensure im_bots extension record exists (idempotent)
        await this.ensureBotRecord(existingBot.id);

        this.logger.log(`System bot found: ${username} (${this.botUserId})`);
        return;
      }

      // Create the bot account in im_users
      const passwordHash = await bcrypt.hash(password, 10);
      const [newBot] = await this.db
        .insert(schema.users)
        .values({
          id: uuidv7(),
          email,
          username,
          displayName,
          passwordHash,
          status: 'online',
          isActive: true,
          emailVerified: true,
          userType: 'bot',
        })
        .returning({ id: schema.users.id });

      // Create the bot extension record in im_bots
      await this.db.insert(schema.bots).values({
        id: uuidv7(),
        userId: newBot.id,
        type: 'system',
        ownerId: null,
        description: 'System bot',
        capabilities: {
          canSendMessages: true,
          canReadMessages: true,
        },
        isActive: true,
      });

      this.botUserId = newBot.id;
      this.logger.log(`System bot created: ${username} (${this.botUserId})`);
    } catch (error) {
      this.logger.error('Failed to initialize system bot:', error);
    }
  }

  /**
   * Ensure the im_bots extension record exists for a given user.
   * Handles migration from old schema where only im_users row existed.
   */
  private async ensureBotRecord(userId: string): Promise<void> {
    const [existing] = await this.db
      .select({ id: schema.bots.id })
      .from(schema.bots)
      .where(eq(schema.bots.userId, userId))
      .limit(1);

    if (!existing) {
      await this.db.insert(schema.bots).values({
        id: uuidv7(),
        userId,
        type: 'system',
        ownerId: null,
        description: 'System bot',
        capabilities: {
          canSendMessages: true,
          canReadMessages: true,
        },
        isActive: true,
      });
      this.logger.log(`Created im_bots extension record for user ${userId}`);
    }
  }

  /**
   * Get the system bot user ID.
   * Returns null if bot is not configured or not initialized.
   */
  getBotUserId(): string | null {
    return this.botUserId;
  }

  /**
   * Check if the system bot is enabled and initialized.
   */
  isBotEnabled(): boolean {
    return this.botUserId !== null;
  }

  /**
   * Check if a given userId belongs to a bot account.
   */
  async isBot(userId: string): Promise<boolean> {
    const [user] = await this.db
      .select({ userType: schema.users.userType })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return user?.userType === 'bot';
  }

  /**
   * Get the bot user details (from im_users shadow record).
   */
  async getBotUser(): Promise<{
    id: string;
    email: string;
    username: string;
    displayName: string | null;
  } | null> {
    if (!this.botUserId) {
      return null;
    }

    const [bot] = await this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        username: schema.users.username,
        displayName: schema.users.displayName,
      })
      .from(schema.users)
      .where(eq(schema.users.id, this.botUserId))
      .limit(1);

    return bot || null;
  }

  /**
   * Get the bot extension profile (from im_bots table).
   */
  async getBotProfile(): Promise<{
    id: string;
    userId: string;
    type: string;
    description: string | null;
    capabilities: BotCapabilities | null;
    isActive: boolean;
  } | null> {
    if (!this.botUserId) {
      return null;
    }

    const [bot] = await this.db
      .select({
        id: schema.bots.id,
        userId: schema.bots.userId,
        type: schema.bots.type,
        description: schema.bots.description,
        capabilities: schema.bots.capabilities,
        isActive: schema.bots.isActive,
      })
      .from(schema.bots)
      .where(eq(schema.bots.userId, this.botUserId))
      .limit(1);

    return bot || null;
  }
}
