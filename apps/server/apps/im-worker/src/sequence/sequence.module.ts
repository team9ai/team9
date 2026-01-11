import { Module } from '@nestjs/common';
import { RedisModule } from '@team9/redis';
import { SequenceService } from './sequence.service.js';

@Module({
  imports: [RedisModule],
  providers: [SequenceService],
  exports: [SequenceService],
})
export class SequenceModule {}
