import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '@team9/redis';

export interface BotAuthContext {
  botId: string;
  userId: string;
  tenantId: string;
}

@Injectable()
export class BotAuthCacheService {
  private readonly positiveTtlSeconds = 30;
  private readonly negativeTtlSeconds = 5;
  private readonly inflight = new Map<string, Promise<BotAuthContext | null>>();

  constructor(private readonly redis: RedisService) {}

  async getOrSetValidation(
    rawToken: string,
    loader: () => Promise<BotAuthContext | null>,
  ): Promise<BotAuthContext | null> {
    const cacheKey = this.cacheKey(rawToken);
    const cached = await this.safeGet(cacheKey);
    if (cached !== null) {
      try {
        const parsed = JSON.parse(cached) as BotAuthContext | { invalid: true };
        return 'invalid' in parsed ? null : parsed;
      } catch {
        // Ignore malformed cache entries and fall through to validation.
      }
    }

    const existing = this.inflight.get(cacheKey);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      const result = await loader();
      if (result) {
        const reverseIndexKey = this.reverseIndexKey(result.botId);
        await this.safeSet(
          cacheKey,
          JSON.stringify(result),
          this.positiveTtlSeconds,
        );
        await this.safeSadd(reverseIndexKey, cacheKey);
        await this.safeExpire(reverseIndexKey, this.positiveTtlSeconds);
        return result;
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
    const reverseIndexKey = this.reverseIndexKey(botId);
    const keys = await this.safeSmembers(reverseIndexKey);
    for (const key of keys) {
      await this.safeDel(key);
    }
    await this.safeDel(reverseIndexKey);
  }

  private cacheKey(rawToken: string): string {
    return `auth:bot-token:${createHash('sha256').update(rawToken).digest('hex')}`;
  }

  private reverseIndexKey(botId: string): string {
    return `auth:bot-token-keys:${botId}`;
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
}
