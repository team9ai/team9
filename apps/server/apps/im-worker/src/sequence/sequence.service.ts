import { Injectable, Logger, Inject } from '@nestjs/common';
import { RedisService } from '@team9/redis';
import { DATABASE_CONNECTION, sql } from '@team9/database';
import type { PostgresJsDatabase } from '@team9/database';
import * as schema from '@team9/database/schemas';

const REDIS_KEYS = {
  CHANNEL_SEQ: (channelId: string) => `im:seq:channel:${channelId}`,
  USER_SEQ: (userId: string) => `im:seq:user:${userId}`,
};

/**
 * Sequence Service - generates unique sequence IDs for messages
 *
 * Uses Redis INCR for atomic, distributed sequence generation.
 * When Redis key doesn't exist, recovers max seqId from database
 * to ensure safety after Redis restart/data loss.
 */
@Injectable()
export class SequenceService {
  private readonly logger = new Logger(SequenceService.name);

  constructor(
    private readonly redisService: RedisService,
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Generate sequence ID for channel message
   *
   * If Redis key doesn't exist, recovers max seqId from database first
   * to ensure safety after Redis restart/data loss.
   */
  async generateChannelSeq(channelId: string): Promise<bigint> {
    const key = REDIS_KEYS.CHANNEL_SEQ(channelId);

    // Check if key exists in Redis
    const exists = await this.redisService.exists(key);

    if (!exists) {
      // Recover max seqId from database
      await this.recoverChannelSeqFromDb(channelId);
    }

    const seq = await this.redisService.incr(key);
    return BigInt(seq);
  }

  /**
   * Recover channel sequence from database
   */
  private async recoverChannelSeqFromDb(channelId: string): Promise<void> {
    const key = REDIS_KEYS.CHANNEL_SEQ(channelId);

    try {
      const result = await this.db
        .select({ maxSeq: sql<string>`COALESCE(MAX(seq_id), 0)` })
        .from(schema.messages)
        .where(sql`${schema.messages.channelId} = ${channelId}`);

      const maxSeq = result[0]?.maxSeq ?? '0';

      // Use SETNX to avoid race condition (only set if not exists)
      const client = this.redisService.getClient();
      await client.setnx(key, maxSeq);

      this.logger.log(
        `Recovered channel ${channelId} seqId from database: ${maxSeq}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to recover seqId for channel ${channelId}: ${error}`,
      );
      // Continue anyway - Redis will start from 0
    }
  }

  /**
   * Generate sequence ID for direct message
   */
  async generateUserSeq(userId: string): Promise<bigint> {
    const key = REDIS_KEYS.USER_SEQ(userId);
    const seq = await this.redisService.incr(key);
    return BigInt(seq);
  }

  /**
   * Batch generate sequence IDs (for group messages)
   */
  async generateChannelSeqBatch(
    channelId: string,
    count: number,
  ): Promise<{ start: bigint; end: bigint }> {
    const key = REDIS_KEYS.CHANNEL_SEQ(channelId);
    const client = this.redisService.getClient();

    const end = await client.incrby(key, count);
    const start = end - count + 1;

    return {
      start: BigInt(start),
      end: BigInt(end),
    };
  }

  /**
   * Get current max sequence ID
   */
  async getCurrentSeq(type: 'channel' | 'user', id: string): Promise<bigint> {
    const key =
      type === 'channel' ? REDIS_KEYS.CHANNEL_SEQ(id) : REDIS_KEYS.USER_SEQ(id);

    const seq = await this.redisService.get(key);
    return seq ? BigInt(seq) : BigInt(0);
  }
}
