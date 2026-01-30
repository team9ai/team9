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

export interface CreateBotOptions {
  username: string;
  displayName?: string;
  email?: string;
  password?: string;
  type?: 'system' | 'custom' | 'webhook';
  ownerId?: string;
  description?: string;
  capabilities?: BotCapabilities;
  webhookUrl?: string;
}

export interface BotInfo {
  userId: string;
  botId: string;
  username: string;
  displayName: string | null;
  email: string;
  type: string;
  description: string | null;
  capabilities: BotCapabilities | null;
  isActive: boolean;
}

/**
 * BotService manages bot accounts.
 *
 * Each bot is stored as two records:
 * - A shadow row in `im_users` (with user_type='bot') for FK compatibility
 * - An extension row in `im_bots` for bot-specific metadata
 *
 * The system bot is automatically created on startup if configured via environment variables.
 * Additional bots can be created dynamically via `createBot()`.
 */
@Injectable()
export class BotService implements OnModuleInit {
  private readonly logger = new Logger(BotService.name);
  private systemBotUserId: string | null = null;

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (env.SYSTEM_BOT_ENABLED) {
      await this.initializeSystemBot();
    } else {
      this.logger.log('System bot is disabled (SYSTEM_BOT_ENABLED != true)');
    }
  }

  /**
   * Initialize the system bot on startup.
   * Finds existing or creates a new one from environment config.
   */
  private async initializeSystemBot(): Promise<void> {
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
      // Check if bot already exists by username
      const [existingUser] = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.username, username))
        .limit(1);

      if (existingUser) {
        this.systemBotUserId = existingUser.id;

        // Ensure user row is correctly marked as bot
        await this.db
          .update(schema.users)
          .set({
            emailVerified: true,
            userType: 'bot',
            updatedAt: new Date(),
          })
          .where(eq(schema.users.id, existingUser.id));

        // Ensure im_bots extension record exists (idempotent)
        const [existingBot] = await this.db
          .select({ id: schema.bots.id })
          .from(schema.bots)
          .where(eq(schema.bots.userId, existingUser.id))
          .limit(1);

        if (!existingBot) {
          await this.db.insert(schema.bots).values({
            id: uuidv7(),
            userId: existingUser.id,
            type: 'system',
            ownerId: null,
            description: 'System bot',
            capabilities: {
              canSendMessages: true,
              canReadMessages: true,
            },
            isActive: true,
          });
        }

        this.logger.log(
          `System bot found: ${username} (${this.systemBotUserId})`,
        );
        return;
      }

      // Create new system bot
      const bot = await this.createBot({
        username,
        displayName,
        email,
        password,
        type: 'system',
        description: 'System bot',
        capabilities: {
          canSendMessages: true,
          canReadMessages: true,
        },
      });

      this.systemBotUserId = bot.userId;
      this.logger.log(
        `System bot created: ${username} (${this.systemBotUserId})`,
      );
    } catch (error) {
      this.logger.error('Failed to initialize system bot:', error);
    }
  }

  /**
   * Create a new bot account.
   * Creates both im_users (shadow) and im_bots (extension) records.
   */
  async createBot(options: CreateBotOptions): Promise<BotInfo> {
    const {
      username,
      displayName,
      email,
      password,
      type = 'custom',
      ownerId,
      description,
      capabilities = { canSendMessages: true, canReadMessages: true },
      webhookUrl,
    } = options;

    // Generate a placeholder email if not provided
    const botEmail = email || `${username}+bot@team9.local`;
    const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;

    // Create shadow user in im_users
    const [newUser] = await this.db
      .insert(schema.users)
      .values({
        id: uuidv7(),
        email: botEmail,
        username,
        displayName: displayName ?? username,
        passwordHash,
        status: 'online',
        isActive: true,
        emailVerified: true,
        userType: 'bot',
      })
      .returning({
        id: schema.users.id,
        email: schema.users.email,
        username: schema.users.username,
        displayName: schema.users.displayName,
      });

    // Create extension record in im_bots
    const [newBot] = await this.db
      .insert(schema.bots)
      .values({
        id: uuidv7(),
        userId: newUser.id,
        type,
        ownerId: ownerId ?? null,
        description: description ?? null,
        capabilities,
        webhookUrl: webhookUrl ?? null,
        isActive: true,
      })
      .returning();

    return {
      userId: newUser.id,
      botId: newBot.id,
      username: newUser.username,
      displayName: newUser.displayName,
      email: newUser.email,
      type: newBot.type,
      description: newBot.description,
      capabilities: newBot.capabilities,
      isActive: newBot.isActive,
    };
  }

  // ── System bot helpers ─────────────────────────────────────────────

  /**
   * Get the system bot user ID.
   * Returns null if bot is not configured or not initialized.
   */
  getSystemBotUserId(): string | null {
    return this.systemBotUserId;
  }

  /** @deprecated Use getSystemBotUserId() instead */
  getBotUserId(): string | null {
    return this.systemBotUserId;
  }

  /**
   * Check if the system bot is enabled and initialized.
   */
  isSystemBotEnabled(): boolean {
    return this.systemBotUserId !== null;
  }

  /** @deprecated Use isSystemBotEnabled() instead */
  isBotEnabled(): boolean {
    return this.systemBotUserId !== null;
  }

  // ── Generic bot queries ────────────────────────────────────────────

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
   * Get bot info by userId (from both im_users and im_bots).
   */
  async getBotByUserId(userId: string): Promise<BotInfo | null> {
    const [row] = await this.db
      .select({
        userId: schema.users.id,
        botId: schema.bots.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        email: schema.users.email,
        type: schema.bots.type,
        description: schema.bots.description,
        capabilities: schema.bots.capabilities,
        isActive: schema.bots.isActive,
      })
      .from(schema.bots)
      .innerJoin(schema.users, eq(schema.bots.userId, schema.users.id))
      .where(eq(schema.users.id, userId))
      .limit(1);

    return row || null;
  }

  /**
   * Get the system bot user details (from im_users shadow record).
   */
  async getSystemBotUser(): Promise<{
    id: string;
    email: string;
    username: string;
    displayName: string | null;
  } | null> {
    if (!this.systemBotUserId) {
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
      .where(eq(schema.users.id, this.systemBotUserId))
      .limit(1);

    return bot || null;
  }

  /** @deprecated Use getSystemBotUser() instead */
  async getBotUser(): Promise<{
    id: string;
    email: string;
    username: string;
    displayName: string | null;
  } | null> {
    return this.getSystemBotUser();
  }

  /**
   * Get the system bot extension profile (from im_bots table).
   */
  async getSystemBotProfile(): Promise<BotInfo | null> {
    if (!this.systemBotUserId) {
      return null;
    }

    return this.getBotByUserId(this.systemBotUserId);
  }

  /** @deprecated Use getSystemBotProfile() instead */
  async getBotProfile(): Promise<BotInfo | null> {
    return this.getSystemBotProfile();
  }
}
