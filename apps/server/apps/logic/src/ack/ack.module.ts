import { Module } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { RedisModule } from '@team9/redis';
import { AckService } from './ack.service.js';

@Module({
  imports: [DatabaseModule, RedisModule],
  providers: [AckService],
  exports: [AckService],
})
export class AckModule {}
