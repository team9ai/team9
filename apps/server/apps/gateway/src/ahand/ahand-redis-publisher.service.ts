import { Inject, Injectable, Logger } from '@nestjs/common';
import { REDIS_CLIENT, type RedisType } from '@team9/redis';

// The AhandOwnerEvent type is re-exported so TaskDefinition 4.3 + 4.6 callers
// can import it without reaching into the gateway's private directory.

export type AhandEventType =
  | 'device.registered'
  | 'device.online'
  | 'device.heartbeat'
  | 'device.offline'
  | 'device.revoked';

export interface AhandOwnerEvent {
  ownerType: 'user' | 'workspace';
  ownerId: string;
  eventType: AhandEventType;
  data: Record<string, unknown>;
}

// Channel pattern: ahand:events:{ownerId}
// im-worker (Task 5.3) subscribes with PSUBSCRIBE ahand:events:* so it
// receives events for all owners. Scoping per-owner lets a future subscriber
// opt into events for a single owner without pattern matching overhead.
function channel(ownerId: string): string {
  return `ahand:events:${ownerId}`;
}

@Injectable()
export class AhandRedisPublisher {
  private readonly logger = new Logger(AhandRedisPublisher.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisType) {}

  async publishForOwner(event: AhandOwnerEvent): Promise<void> {
    const ch = channel(event.ownerId);
    const payload = JSON.stringify({
      ownerType: event.ownerType,
      eventType: event.eventType,
      data: event.data,
      publishedAt: new Date().toISOString(),
    });
    try {
      const subscribers = await this.redis.publish(ch, payload);
      if (subscribers === 0) {
        this.logger.debug(
          `Published ${event.eventType} to ${ch} -- 0 subscribers (may indicate misconfig)`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Redis publish failed for ${ch}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
