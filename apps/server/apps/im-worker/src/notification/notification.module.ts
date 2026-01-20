import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service.js';
import { NotificationTriggerService } from './notification-trigger.service.js';
import { NotificationConsumerService } from './notification-consumer.service.js';

/**
 * Notification Module for im-worker
 *
 * Handles notification processing:
 * - Consumes notification tasks from RabbitMQ (via @RabbitSubscribe decorator)
 * - Creates and persists notifications to database
 * - Publishes delivery tasks to Gateway via RabbitMQ
 *
 * Note: Queue and exchange setup is handled automatically by @RabbitSubscribe
 * decorator in NotificationConsumerService
 */
@Module({
  providers: [
    NotificationService,
    NotificationTriggerService,
    NotificationConsumerService,
  ],
  exports: [NotificationService, NotificationTriggerService],
})
export class NotificationModule {}
