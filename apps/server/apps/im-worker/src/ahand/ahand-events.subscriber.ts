import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { REDIS_CLIENT, type RedisType } from '@team9/redis';
import {
  AhandSessionDispatcher,
  type AhandDispatchInput,
} from './ahand-session-dispatcher.stub.js';

const PATTERN = 'ahand:events:*';

/**
 * Subscribes to Redis pattern `ahand:events:*` so gateway-originated device
 * events (published by AhandRedisPublisher) reach im-worker regardless of
 * which gateway replica handled the webhook.
 *
 * Uses a **dedicated** duplicate connection because ioredis clients in
 * PSUBSCRIBE mode cannot issue regular commands.
 *
 * `AhandSessionDispatcher` (Task 5.4) is called on each event. Dispatch
 * errors are caught here so one flaky session never kills the subscriber loop.
 */
@Injectable()
export class AhandEventsSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AhandEventsSubscriber.name);
  private subscriber: ReturnType<RedisType['duplicate']> | null = null;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisType,
    private readonly dispatcher: AhandSessionDispatcher,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscriber = this.redis.duplicate();
    await this.subscriber.psubscribe(PATTERN);
    this.subscriber.on('pmessage', this.onMessage);
    this.subscriber.on('error', (e) =>
      this.logger.error('Redis subscriber error', e),
    );
    this.subscriber.on('reconnecting', () =>
      this.logger.warn('Redis subscriber reconnecting'),
    );
    this.logger.log(`Subscribed to ${PATTERN}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      this.subscriber.off('pmessage', this.onMessage);
      await this.subscriber.punsubscribe(PATTERN).catch(() => undefined);
      this.subscriber.disconnect();
      this.subscriber = null;
    }
  }

  // Arrow function so `this` is preserved when passed as event listener.
  private readonly onMessage = (
    _pattern: string,
    channel: string,
    messageRaw: string,
  ): void => {
    const ownerId = channel.replace(/^ahand:events:/, '');
    if (!ownerId || ownerId === channel) {
      this.logger.warn(`Message on unexpected channel: ${channel}`);
      return;
    }

    let payload: AhandDispatchInput & { publishedAt?: string };
    try {
      payload = JSON.parse(messageRaw) as AhandDispatchInput & {
        publishedAt?: string;
      };
    } catch (e) {
      this.logger.error(`Malformed JSON on channel=${channel}: ${e}`);
      return;
    }

    if (!payload.eventType) {
      this.logger.warn(`Payload missing eventType on channel=${channel}`);
      return;
    }

    this.dispatcher
      .dispatch({
        ownerType: payload.ownerType,
        ownerId,
        eventType: payload.eventType,
        data: payload.data ?? {},
      })
      .catch((e: unknown) =>
        this.logger.error(
          `dispatch error for ${payload.eventType} on ${channel}: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
  };
}
