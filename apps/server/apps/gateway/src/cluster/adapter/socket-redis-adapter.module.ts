import { Module } from '@nestjs/common';
import { RedisModule } from '@team9/redis';
import { SocketRedisAdapterService } from './socket-redis-adapter.service.js';

@Module({
  imports: [RedisModule],
  providers: [SocketRedisAdapterService],
  exports: [SocketRedisAdapterService],
})
export class SocketRedisAdapterModule {}
