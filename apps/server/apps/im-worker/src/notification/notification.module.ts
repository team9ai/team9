import { Module, Logger, OnModuleInit } from '@nestjs/common';
import { RabbitMQEventService } from '@team9/rabbitmq';
import { NotificationService } from './notification.service.js';
import { NotificationTriggerService } from './notification-trigger.service.js';
import { NotificationConsumerService } from './notification-consumer.service.js';

/**
 * Notification Module for im-worker
 *
 * Handles notification processing:
 * - Consumes notification tasks from RabbitMQ
 * - Creates and persists notifications to database
 * - Publishes delivery tasks to Gateway via RabbitMQ
 */
@Module({
  providers: [
    NotificationService,
    NotificationTriggerService,
    NotificationConsumerService,
  ],
  exports: [NotificationService, NotificationTriggerService],
})
export class NotificationModule implements OnModuleInit {
  private readonly logger = new Logger(NotificationModule.name);

  constructor(private readonly rabbitMQEventService: RabbitMQEventService) {}

  async onModuleInit() {
    // Setup notification delivery exchange and queue
    await this.rabbitMQEventService.setupNotificationExchange();
    await this.rabbitMQEventService.setupDeliveryExchange();
    this.logger.log('Notification module initialized with RabbitMQ exchanges');
  }
}
