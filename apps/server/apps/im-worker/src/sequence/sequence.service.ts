import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@team9/redis';

const REDIS_KEYS = {
  CHANNEL_SEQ: (channelId: string) => `im:seq:channel:${channelId}`,
  USER_SEQ: (userId: string) => `im:seq:user:${userId}`,
};

/**
 * Sequence Service - generates unique sequence IDs for messages
 *
 * Uses Redis INCR for atomic, distributed sequence generation
 */
@Injectable()
export class SequenceService {
  private readonly logger = new Logger(SequenceService.name);

  constructor(private readonly redisService: RedisService) {}

  /**
   * Generate sequence ID for channel message
   */
  async generateChannelSeq(channelId: string): Promise<bigint> {
    const key = REDIS_KEYS.CHANNEL_SEQ(channelId);
    const seq = await this.redisService.incr(key);
    return BigInt(seq);
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
