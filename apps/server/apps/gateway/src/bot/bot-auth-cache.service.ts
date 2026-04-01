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
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as BotAuthContext | { invalid: true };
      return 'invalid' in parsed ? null : parsed;
    }

    const existing = this.inflight.get(cacheKey);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      const result = await loader();
      if (result) {
        const reverseIndexKey = this.reverseIndexKey(result.botId);
        await this.redis.set(
          cacheKey,
          JSON.stringify(result),
          this.positiveTtlSeconds,
        );
        await this.redis.sadd(reverseIndexKey, cacheKey);
        await this.redis.expire(reverseIndexKey, this.positiveTtlSeconds);
        return result;
      }

      await this.redis.set(
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
    const keys = await this.redis.smembers(reverseIndexKey);
    if (keys.length > 0) {
      await this.redis.del(...keys, reverseIndexKey);
      return;
    }

    await this.redis.del(reverseIndexKey);
  }

  private cacheKey(rawToken: string): string {
    return `auth:bot-token:${createHash('sha256').update(rawToken).digest('hex')}`;
  }

  private reverseIndexKey(botId: string): string {
    return `auth:bot-token-keys:${botId}`;
  }
}
