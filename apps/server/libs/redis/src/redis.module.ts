import { Module, Global, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants.js';
import { RedisService } from './redis.service.js';
import { env } from '@team9/shared';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const logger = new Logger('RedisModule');

        const host = env.REDIS_HOST;
        const port = env.REDIS_PORT;
        const password = env.REDIS_PASSWORD;

        logger.log(`Connecting to Redis at ${host}:${port}`);

        const client = new Redis({
          host,
          port,
          password,
          retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            return delay;
          },
        });

        client.on('connect', () => {
          logger.log('Redis connected successfully');
        });

        client.on('error', (err) => {
          logger.error('Redis connection error:', err);
        });

        return client;
      },
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule implements OnModuleDestroy {
  constructor(private readonly redisService: RedisService) {}

  async onModuleDestroy() {
    const client = this.redisService.getClient();
    await client.quit();
  }
}
