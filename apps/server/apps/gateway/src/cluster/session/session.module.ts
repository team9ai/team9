import { Module } from '@nestjs/common';
import { RedisModule } from '@team9/redis';
import { SessionService } from './session.service.js';

@Module({
  imports: [RedisModule],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}
