import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DATABASE_CONNECTION } from './database.constants.js';
import * as schema from './schemas/index.js';
import { Config } from './schemas/config.js';
import { ConfigKey } from './config-keys.js';

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);
  private configCache = new Map<string, string>();

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Load all configurations into memory cache
   */
  async loadConfigs(): Promise<void> {
    try {
      const configs = await this.db.select().from(schema.config);
      this.configCache.clear();
      configs.forEach((config) => {
        this.configCache.set(config.key, config.value);
      });
      this.logger.log(`Loaded ${configs.length} configurations from database`);
    } catch (error) {
      this.logger.error('Failed to load configurations from database', error);
      throw error;
    }
  }

  /**
   * Get configuration value by key
   */
  get(key: string, defaultValue?: string): string | undefined {
    return this.configCache.get(key) ?? defaultValue;
  }

  /**
   * Get configuration value by key (throws if not found)
   */
  getOrThrow(key: string): string {
    const value = this.configCache.get(key);
    if (value === undefined) {
      throw new Error(`Configuration key "${key}" not found`);
    }
    return value;
  }

  /**
   * Get all configurations
   */
  getAll(): Map<string, string> {
    return new Map(this.configCache);
  }

  /**
   * Set or update configuration
   */
  async set(
    key: string,
    value: string,
    description?: string,
    isSecret = false,
  ): Promise<Config> {
    try {
      const existing = await this.db
        .select()
        .from(schema.config)
        .where(eq(schema.config.key, key))
        .limit(1);

      let result: Config;

      if (existing.length > 0) {
        // Update existing
        const updated = await this.db
          .update(schema.config)
          .set({ value, description, isSecret, updatedAt: new Date() })
          .where(eq(schema.config.key, key))
          .returning();
        result = updated[0];
      } else {
        // Insert new
        const inserted = await this.db
          .insert(schema.config)
          .values({ key, value, description, isSecret })
          .returning();
        result = inserted[0];
      }

      // Update cache
      this.configCache.set(key, value);
      this.logger.log(`Configuration "${key}" updated`);

      return result;
    } catch (error) {
      this.logger.error(`Failed to set configuration "${key}"`, error);
      throw error;
    }
  }

  /**
   * Delete configuration
   */
  async delete(key: string): Promise<void> {
    try {
      await this.db.delete(schema.config).where(eq(schema.config.key, key));
      this.configCache.delete(key);
      this.logger.log(`Configuration "${key}" deleted`);
    } catch (error) {
      this.logger.error(`Failed to delete configuration "${key}"`, error);
      throw error;
    }
  }

  /**
   * Get AI provider configuration
   */
  getAIProviderConfig(provider: 'openai' | 'claude' | 'gemini' | 'openrouter') {
    switch (provider) {
      case 'openai':
        return {
          apiKey: this.get(
            ConfigKey.OPENAI_API_KEY,
            process.env.OPENAI_API_KEY,
          ),
          baseURL: this.get(ConfigKey.OPENAI_BASE_URL),
        };
      case 'claude':
        return {
          apiKey: this.get(
            ConfigKey.CLAUDE_API_KEY,
            process.env.ANTHROPIC_API_KEY,
          ),
        };
      case 'gemini':
        return {
          apiKey: this.get(
            ConfigKey.GEMINI_API_KEY,
            process.env.GOOGLE_API_KEY,
          ),
        };
      case 'openrouter':
        return {
          apiKey: this.get(
            ConfigKey.OPENROUTER_API_KEY,
            process.env.OPENROUTER_API_KEY,
          ),
          referer: this.get(
            ConfigKey.OPENROUTER_REFERER,
            process.env.OPENROUTER_REFERER,
          ),
          title: this.get(
            ConfigKey.OPENROUTER_TITLE,
            process.env.OPENROUTER_TITLE,
          ),
        };
    }
  }

  /**
   * Check if AI provider is configured
   */
  isAIProviderConfigured(
    provider: 'openai' | 'claude' | 'gemini' | 'openrouter',
  ): boolean {
    const config = this.getAIProviderConfig(provider);
    return !!config.apiKey;
  }
}
