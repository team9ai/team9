import { Module } from '@nestjs/common';
import { PushSubscriptionController } from './push-subscription.controller.js';
import { PushSubscriptionService } from './push-subscription.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [PushSubscriptionController],
  providers: [PushSubscriptionService],
  exports: [PushSubscriptionService],
})
export class PushSubscriptionModule {}
