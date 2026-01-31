import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { v7 as uuidv7 } from 'uuid';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  like,
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
  ownerId: string | null;
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
    private readonly eventEmitter: EventEmitter2,
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

    const botInfo: BotInfo = {
      userId: newUser.id,
      botId: newBot.id,
      username: newUser.username,
      displayName: newUser.displayName,
      email: newUser.email,
      type: newBot.type,
      ownerId: newBot.ownerId,
      description: newBot.description,
      capabilities: newBot.capabilities,
      isActive: newBot.isActive,
    };

    this.eventEmitter.emit('bot.created', botInfo);

    return botInfo;
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
        ownerId: schema.bots.ownerId,
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

  // ── Access Token Management ──────────────────────────────────────

  /**
   * Generate a new access token for a bot.
   * The raw token is returned only once and cannot be retrieved later.
   *
   * Token format: `t9bot_` + 96 hex chars (48 random bytes)
   * Storage format: `{fingerprint}:{bcryptHash}` in im_bots.accessToken
   */
  async generateAccessToken(botId: string): Promise<BotTokenResult> {
    const [bot] = await this.db
      .select({
        id: schema.bots.id,
        userId: schema.bots.userId,
      })
      .from(schema.bots)
      .where(eq(schema.bots.id, botId))
      .limit(1);

    if (!bot) {
      throw new Error(`Bot not found: ${botId}`);
    }

    const rawHex = crypto.randomBytes(48).toString('hex');
    const rawToken = `t9bot_${rawHex}`;
    const fingerprint = rawHex.slice(0, 8);
    const hash = await bcrypt.hash(rawHex, 10);

    await this.db
      .update(schema.bots)
      .set({
        accessToken: `${fingerprint}:${hash}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.bots.id, botId));

    return { botId, userId: bot.userId, accessToken: rawToken };
  }

  /**
   * Validate a bot access token and return the associated user info.
   * Returns null if the token is invalid or the bot is inactive.
   */
  async validateAccessToken(
    rawToken: string,
  ): Promise<{ userId: string; email: string; username: string } | null> {
    // Strip the t9bot_ prefix to get the raw hex
    const rawHex = rawToken.startsWith('t9bot_') ? rawToken.slice(6) : rawToken;

    if (rawHex.length === 0) return null;

    const fingerprint = rawHex.slice(0, 8);

    // Use fingerprint for quick lookup instead of scanning all bots
    const rows = await this.db
      .select({
        botId: schema.bots.id,
        userId: schema.bots.userId,
        accessToken: schema.bots.accessToken,
        email: schema.users.email,
        username: schema.users.username,
      })
      .from(schema.bots)
      .innerJoin(schema.users, eq(schema.bots.userId, schema.users.id))
      .where(
        and(
          like(schema.bots.accessToken, `${fingerprint}:%`),
          eq(schema.bots.isActive, true),
        ),
      );

    for (const row of rows) {
      const storedHash = row.accessToken!.slice(fingerprint.length + 1);
      const isValid = await bcrypt.compare(rawHex, storedHash);
      if (isValid) {
        return {
          userId: row.userId,
          email: row.email,
          username: row.username,
        };
      }
    }

    return null;
  }

  /**
   * Revoke a bot's access token.
   */
  async revokeAccessToken(botId: string): Promise<void> {
    await this.db
      .update(schema.bots)
      .set({ accessToken: null, updatedAt: new Date() })
      .where(eq(schema.bots.id, botId));
  }

  /**
   * Update a bot's webhook configuration.
   */
  async updateWebhook(
    botId: string,
    webhookUrl: string | null,
    webhookHeaders?: Record<string, string> | null,
  ): Promise<void> {
    const update: Record<string, unknown> = {
      webhookUrl,
      updatedAt: new Date(),
    };
    if (webhookHeaders !== undefined) {
      update.webhookHeaders = webhookHeaders ?? {};
    }
    await this.db
      .update(schema.bots)
      .set(update)
      .where(eq(schema.bots.id, botId));
  }

  /**
   * Get a bot by its botId (from im_bots table).
   */
  async getBotById(botId: string): Promise<BotInfo | null> {
    const [row] = await this.db
      .select({
        userId: schema.users.id,
        botId: schema.bots.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        email: schema.users.email,
        type: schema.bots.type,
        ownerId: schema.bots.ownerId,
        description: schema.bots.description,
        capabilities: schema.bots.capabilities,
        isActive: schema.bots.isActive,
      })
      .from(schema.bots)
      .innerJoin(schema.users, eq(schema.bots.userId, schema.users.id))
      .where(eq(schema.bots.id, botId))
      .limit(1);

    return row || null;
  }
}

export interface BotTokenResult {
  botId: string;
  userId: string;
  accessToken: string;
}
