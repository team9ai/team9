import { Module } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { WebhookController } from './webhook.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [WebhookController],
})
export class WebhookModule {}
