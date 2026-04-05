import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PushController } from './push.controller.js';
import { ExpoPushService } from './push.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PushController],
  providers: [ExpoPushService],
  exports: [ExpoPushService],
})
export class PushModule {}
