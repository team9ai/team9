import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '@team9/redis';

export interface BotAuthContext {
  botId: string;
  userId: string;
  tenantId: string;
}

interface VersionedBotAuthContext {
  context: BotAuthContext;
  version: number | null;
}

type CachedBotAuthPayload =
  | { invalid: true }
  | VersionedBotAuthContext
  | BotAuthContext;

@Injectable()
export class BotAuthCacheService {
  private readonly positiveTtlSeconds = 30;
  private readonly negativeTtlSeconds = 5;
  private readonly mutationTtlSeconds = 30;
  private readonly inflight = new Map<string, Promise<BotAuthContext | null>>();

  constructor(private readonly redis: RedisService) {}

  async getOrSetValidation(
    rawToken: string,
    loader: () => Promise<BotAuthContext | VersionedBotAuthContext | null>,
  ): Promise<BotAuthContext | null> {
    const cacheKey = this.cacheKey(rawToken);
    const existing = this.inflight.get(cacheKey);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      const cached = await this.safeGet(cacheKey);
      const cachedContext = await this.getValidCachedContext(cacheKey, cached);
      if (cachedContext !== undefined) {
        return cachedContext;
      }

      const result = await loader();
      if (result) {
        const versioned = await this.resolveVersionedContext(result);
        if (versioned.version !== null) {
          const reverseIndexKey = this.reverseIndexKey(versioned.context.botId);
          await this.safeSet(
            cacheKey,
            JSON.stringify(versioned),
            this.positiveTtlSeconds,
          );
          await this.safeSadd(reverseIndexKey, cacheKey);
          await this.safeExpire(reverseIndexKey, this.positiveTtlSeconds);
        }
        return versioned.context;
      }

      await this.safeSet(
        cacheKey,
        JSON.stringify({ invalid: true }),
        this.negativeTtlSeconds,
      );
      return null;
    })();

    this.inflight.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(cacheKey);
    }
  }

  async invalidateBot(botId: string): Promise<void> {
    await this.bumpBotVersion(botId);

    const reverseIndexKey = this.reverseIndexKey(botId);
    const keys = await this.safeSmembers(reverseIndexKey);
    for (const key of keys) {
      await this.safeDel(key);
    }
    await this.safeDel(reverseIndexKey);
  }

  async beginBotMutation(botId: string): Promise<void> {
    await this.redis.set(this.mutationKey(botId), '1', this.mutationTtlSeconds);
  }

  async endBotMutation(botId: string): Promise<void> {
    await this.safeDel(this.mutationKey(botId));
  }

  async isBotMutationInProgress(botId: string): Promise<boolean> {
    try {
      return (await this.redis.exists(this.mutationKey(botId))) > 0;
    } catch {
      return false;
    }
  }

  async getBotVersion(botId: string): Promise<number | null> {
    const raw = await this.safeGet(this.versionKey(botId));
    if (raw === null) {
      return 0;
    }

    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private cacheKey(rawToken: string): string {
    return `auth:bot-token:${createHash('sha256').update(rawToken).digest('hex')}`;
  }

  private reverseIndexKey(botId: string): string {
    return `auth:bot-token-keys:${botId}`;
  }

  private versionKey(botId: string): string {
    return `auth:bot-token-version:${botId}`;
  }

  private mutationKey(botId: string): string {
    return `auth:bot-token-mutation:${botId}`;
  }

  private async getValidCachedContext(
    cacheKey: string,
    cached: string | null,
  ): Promise<BotAuthContext | null | undefined> {
    if (cached === null) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(cached) as CachedBotAuthPayload;
      if ('invalid' in parsed) {
        return null;
      }

      if (!('context' in parsed)) {
        await this.safeDel(cacheKey);
        return undefined;
      }

      if (await this.isBotMutationInProgress(parsed.context.botId)) {
        return null;
      }

      const currentVersion = await this.getBotVersion(parsed.context.botId);
      if (currentVersion === null) {
        return undefined;
      }

      if (parsed.version !== currentVersion) {
        await this.safeDel(cacheKey);
        return undefined;
      }

      return parsed.context;
    } catch {
      return undefined;
    }
  }

  private async resolveVersionedContext(
    result: BotAuthContext | VersionedBotAuthContext,
  ): Promise<VersionedBotAuthContext> {
    if ('context' in result) {
      return result;
    }

    return {
      context: result,
      version: await this.getBotVersion(result.botId),
    };
  }

  private async safeGet(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch {
      return null;
    }
  }

  private async safeSet(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redis.set(key, value, ttlSeconds);
    } catch {
      // Best-effort cache write.
    }
  }

  private async safeSadd(key: string, member: string): Promise<void> {
    try {
      await this.redis.sadd(key, member);
    } catch {
      // Best-effort reverse index maintenance.
    }
  }

  private async safeExpire(key: string, seconds: number): Promise<void> {
    try {
      await this.redis.expire(key, seconds);
    } catch {
      // Best-effort reverse index maintenance.
    }
  }

  private async safeSmembers(key: string): Promise<string[]> {
    try {
      return await this.redis.smembers(key);
    } catch {
      return [];
    }
  }

  private async safeDel(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch {
      // Best-effort invalidation.
    }
  }

  private async bumpBotVersion(botId: string): Promise<number> {
    return this.redis.incr(this.versionKey(botId));
  }
}
