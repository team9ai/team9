import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PushController } from './push.controller.js';
import { PushService } from './push.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
