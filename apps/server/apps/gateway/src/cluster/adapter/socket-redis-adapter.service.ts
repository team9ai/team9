import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { RedisService } from '@team9/redis';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';

const SOCKET_REDIS_KEY_PREFIX =
  process.env.SOCKET_REDIS_KEY_PREFIX || 'im:socket:';

@Injectable()
export class SocketRedisAdapterService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SocketRedisAdapterService.name);
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;
  private adapterInstance: ReturnType<typeof createAdapter> | null = null;

  constructor(private readonly redisService: RedisService) {}

  async onModuleInit() {
    try {
      const baseClient = this.redisService.getClient();

      this.pubClient = baseClient.duplicate();
      this.subClient = baseClient.duplicate();

      await Promise.all([
        new Promise<void>((resolve, reject) => {
          this.pubClient!.once('ready', resolve);
          this.pubClient!.once('error', reject);
        }),
        new Promise<void>((resolve, reject) => {
          this.subClient!.once('ready', resolve);
          this.subClient!.once('error', reject);
        }),
      ]);

      this.adapterInstance = createAdapter(this.pubClient, this.subClient, {
        key: SOCKET_REDIS_KEY_PREFIX,
      });

      this.logger.log(
        `Socket.io Redis Adapter initialized with prefix: ${SOCKET_REDIS_KEY_PREFIX}`,
      );
    } catch (error) {
      this.logger.error('Failed to initialize Socket.io Redis Adapter', error);
      throw error;
    }
  }

  getAdapter(): ReturnType<typeof createAdapter> {
    if (!this.adapterInstance) {
      throw new Error(
        'Socket.io Redis Adapter not initialized. Call onModuleInit first.',
      );
    }
    return this.adapterInstance;
  }

  isInitialized(): boolean {
    return this.adapterInstance !== null;
  }

  async onModuleDestroy() {
    this.logger.log('Shutting down Socket.io Redis Adapter...');

    try {
      if (this.pubClient) {
        await this.pubClient.quit();
        this.pubClient = null;
      }
      if (this.subClient) {
        await this.subClient.quit();
        this.subClient = null;
      }
      this.adapterInstance = null;

      this.logger.log('Socket.io Redis Adapter shut down successfully');
    } catch (error) {
      this.logger.error('Error shutting down Socket.io Redis Adapter', error);
    }
  }
}
