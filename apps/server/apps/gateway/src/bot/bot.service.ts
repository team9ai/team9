import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import * as bcrypt from 'bcrypt';
import {
  DATABASE_CONNECTION,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { env } from '@team9/shared';

/**
 * BotService manages the system bot account (Moltbot).
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
      // Check if bot already exists
      const [existingBot] = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);

      if (existingBot) {
        this.botUserId = existingBot.id;
        // Ensure bot email is always verified
        await this.db
          .update(schema.users)
          .set({ emailVerified: true })
          .where(eq(schema.users.id, existingBot.id));
        this.logger.log(`System bot found: ${username} (${this.botUserId})`);
        return;
      }

      // Create the bot account
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
        })
        .returning({ id: schema.users.id });

      this.botUserId = newBot.id;
      this.logger.log(`System bot created: ${username} (${this.botUserId})`);
    } catch (error) {
      this.logger.error('Failed to initialize system bot:', error);
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
   * Get the bot user details.
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
}
