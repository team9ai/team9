import { Global, Module } from '@nestjs/common';
import { BillingHubService } from './billing-hub.service.js';

@Global()
@Module({
  providers: [BillingHubService],
  exports: [BillingHubService],
})
export class BillingHubModule {}
