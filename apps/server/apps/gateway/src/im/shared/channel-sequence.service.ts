import { Injectable, Logger, Inject } from '@nestjs/common';
import { RedisService } from '@team9/redis';
import { DATABASE_CONNECTION, sql } from '@team9/database';
import type { PostgresJsDatabase } from '@team9/database';
import * as schema from '@team9/database/schemas';

const REDIS_KEYS = {
  CHANNEL_SEQ: (channelId: string) => `im:seq:channel:${channelId}`,
};

/**
 * ChannelSequenceService — generates seqIds for channel messages on the gateway side.
 *
 * Uses the EXACT same Redis key pattern as the IM Worker's SequenceService
 * (`im:seq:channel:{channelId}`) so that seqIds remain contiguous across
 * services (new messages via im-worker and edits/deletes via gateway both
 * use the same counter).
 *
 * Recovery logic: when the Redis key is missing (e.g. after a Redis restart),
 * the service recovers the current max seqId from the database and seeds the
 * key via SETNX before incrementing, preventing duplicate or regressed seqIds.
 */
@Injectable()
export class ChannelSequenceService {
  private readonly logger = new Logger(ChannelSequenceService.name);

  constructor(
    private readonly redisService: RedisService,
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Generate the next sequence ID for a channel.
   *
   * If the Redis key does not exist, recovers the max seqId from the database
   * first (using SETNX to guard against race conditions), then increments.
   */
  async generateChannelSeq(channelId: string): Promise<bigint> {
    const key = REDIS_KEYS.CHANNEL_SEQ(channelId);

    // Check if the counter key exists in Redis
    const exists = await this.redisService.exists(key);

    if (!exists) {
      // Recover max seqId from DB before starting the counter
      await this.recoverChannelSeqFromDb(channelId);
    }

    const seq = await this.redisService.incr(key);
    return BigInt(seq);
  }

  /**
   * Recover the channel sequence counter from the database.
   *
   * Queries MAX(seq_id) for the channel and seeds the Redis key via SETNX
   * so that concurrent recovery attempts don't clobber each other.
   */
  private async recoverChannelSeqFromDb(channelId: string): Promise<void> {
    const key = REDIS_KEYS.CHANNEL_SEQ(channelId);

    try {
      const result = await this.db
        .select({ maxSeq: sql<string>`COALESCE(MAX(seq_id), 0)` })
        .from(schema.messages)
        .where(sql`${schema.messages.channelId} = ${channelId}`);

      const maxSeq = result[0]?.maxSeq ?? '0';

      // Use SETNX to avoid overwriting if another instance already seeded the key
      const client = this.redisService.getClient();
      await client.setnx(key, maxSeq);

      this.logger.log(
        `Recovered channel ${channelId} seqId from database: ${maxSeq}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to recover seqId for channel ${channelId}: ${error}`,
      );
      // Continue anyway — Redis will start the counter from 0
    }
  }
}
