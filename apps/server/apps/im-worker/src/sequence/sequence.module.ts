import { Module } from '@nestjs/common';
import { RedisModule } from '@team9/redis';
import { DatabaseModule } from '@team9/database';
import { SequenceService } from './sequence.service.js';

@Module({
  imports: [RedisModule, DatabaseModule],
  providers: [SequenceService],
  exports: [SequenceService],
})
export class SequenceModule {}
