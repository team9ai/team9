import { Injectable, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants.js';

@Injectable()
export class RedisService {
  private readonly NULL_MARKER = '__CACHE_NULL__';
  // Singleflight: prevent cache stampede by deduplicating concurrent DB calls for the same key
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async getOrSet<T>(
    key: string,
    fn: () => Promise<T | null>,
    ttlSeconds: number = 300,
  ): Promise<T | null> {
    try {
      const cached = await this.redis.get(key);
      if (cached !== null) {
        if (cached === this.NULL_MARKER) {
          return null;
        }
        return JSON.parse(cached) as T;
      }
    } catch {
      return fn();
    }

    // Singleflight: if another request is already fetching this key, wait for it
    const existing = this.inflight.get(key);
    if (existing) {
      return existing as Promise<T | null>;
    }

    const promise = this.fetchAndCache<T>(key, fn, ttlSeconds);
    this.inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async fetchAndCache<T>(
    key: string,
    fn: () => Promise<T | null>,
    ttlSeconds: number,
  ): Promise<T | null> {
    const result = await fn();

    try {
      if (result === null || result === undefined) {
        await this.redis.set(
          key,
          this.NULL_MARKER,
          'EX',
          Math.min(ttlSeconds, 60),
        );
      } else {
        await this.redis.set(key, JSON.stringify(result), 'EX', ttlSeconds);
      }
    } catch {
      // Cache writes are best-effort and should not fail the caller.
    }

    return result;
  }

  async invalidate(...keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }
    return this.redis.del(...keys);
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<'OK' | null> {
    if (ttlSeconds) {
      return this.redis.set(key, value, 'EX', ttlSeconds);
    }
    return this.redis.set(key, value);
  }

  async del(key: string): Promise<number> {
    return this.redis.del(key);
  }

  async exists(key: string): Promise<number> {
    return this.redis.exists(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.redis.expire(key, seconds);
  }

  async ttl(key: string): Promise<number> {
    return this.redis.ttl(key);
  }

  async incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }

  async decr(key: string): Promise<number> {
    return this.redis.decr(key);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.redis.hget(key, field);
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    return this.redis.hset(key, field, value);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.redis.hgetall(key);
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    return this.redis.hdel(key, ...fields);
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    return this.redis.lpush(key, ...values);
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    return this.redis.rpush(key, ...values);
  }

  async lpop(key: string): Promise<string | null> {
    return this.redis.lpop(key);
  }

  async rpop(key: string): Promise<string | null> {
    return this.redis.rpop(key);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.redis.lrange(key, start, stop);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.redis.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    return this.redis.srem(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return this.redis.smembers(key);
  }

  async sismember(key: string, member: string): Promise<number> {
    return this.redis.sismember(key, member);
  }

  /**
   * Publish a message to a channel. Best-effort — callers should treat pub/sub
   * as non-authoritative (eventual consistency) and not rely on delivery for
   * correctness.
   */
  async publish(channel: string, message: string): Promise<number> {
    return this.redis.publish(channel, message);
  }

  /**
   * Create a dedicated subscriber connection. ioredis requires separate
   * connections for subscribe/publish — the primary client cannot issue
   * normal commands once it enters subscribe mode. Callers own the returned
   * connection and are responsible for `.quit()` on module destroy.
   */
  createSubscriber(): Redis {
    return this.redis.duplicate();
  }

  getClient(): Redis {
    return this.redis;
  }
}
