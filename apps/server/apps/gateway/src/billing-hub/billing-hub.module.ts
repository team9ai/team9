import { Global, Module } from '@nestjs/common';
import { BillingHubService } from './billing-hub.service.js';
import { BillingHubWebhookController } from './billing-hub-webhook.controller.js';

@Global()
@Module({
  controllers: [BillingHubWebhookController],
  providers: [BillingHubService],
  exports: [BillingHubService],
})
export class BillingHubModule {}
