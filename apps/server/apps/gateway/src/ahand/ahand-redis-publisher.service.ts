import { Inject, Injectable, Logger } from '@nestjs/common';
import { REDIS_CLIENT, type RedisType } from '@team9/redis';

// Event shape published onto the shared Redis `ahand:events` channel.
// im-worker's AhandEventsSubscriber reads from the same channel.
// Task 4.7 formalises the publisher; Task 5.3 formalises the subscriber.
//
// We keep this stub here so Task 4.3 (AhandDevicesService) can depend on the
// type + class without pulling the full implementation forward.

export type AhandEventType =
  | 'device.registered'
  | 'device.revoked'
  | 'device.presence.changed';

export interface AhandOwnerEvent {
  ownerType: 'user' | 'workspace';
  ownerId: string;
  eventType: AhandEventType;
  data: Record<string, unknown>;
}

const CHANNEL = 'ahand:events';

@Injectable()
export class AhandRedisPublisher {
  private readonly logger = new Logger(AhandRedisPublisher.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisType) {}

  async publishForOwner(event: AhandOwnerEvent): Promise<void> {
    const payload = JSON.stringify({
      ...event,
      emittedAt: new Date().toISOString(),
    });
    try {
      await this.redis.publish(CHANNEL, payload);
    } catch (error) {
      // Swallow transport errors: presence/notification is best-effort.
      // Persistent state lives in Postgres, so a missed publish just means
      // subscribers reconcile on next heartbeat.
      this.logger.warn(
        `Failed to publish ${event.eventType} for ${event.ownerType}:${event.ownerId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
