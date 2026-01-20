import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  RabbitSubscribe,
  RABBITMQ_QUEUES,
  RABBITMQ_EXCHANGES,
} from '@team9/rabbitmq';
import type { NotificationDeliveryTask } from '@team9/shared';
import { NotificationDeliveryService } from './notification-delivery.service.js';

/**
 * Notification Delivery Consumer Service for Gateway
 *
 * Consumes delivery tasks from RabbitMQ (published by im-worker)
 * and pushes notifications to users via WebSocket
 */
@Injectable()
export class NotificationDeliveryConsumerService implements OnModuleInit {
  private readonly logger = new Logger(
    NotificationDeliveryConsumerService.name,
  );

  constructor(private readonly deliveryService: NotificationDeliveryService) {}

  onModuleInit() {
    this.logger.log(
      'NotificationDeliveryConsumerService initialized in Gateway',
    );
  }

  /**
   * Handle delivery tasks from RabbitMQ
   */
  @RabbitSubscribe({
    exchange: RABBITMQ_EXCHANGES.NOTIFICATION_DELIVERY,
    routingKey: 'delivery.#',
    queue: RABBITMQ_QUEUES.NOTIFICATION_DELIVERY,
    queueOptions: {
      durable: true,
    },
  })
  async handleDeliveryTask(task: NotificationDeliveryTask): Promise<void> {
    this.logger.debug(
      `Received delivery task: ${task.type} for user: ${task.userId}`,
    );

    try {
      switch (task.type) {
        case 'new':
          await this.deliveryService.deliverToUser(task.userId, task.payload);
          break;
        case 'counts':
          await this.deliveryService.broadcastCountsUpdate(
            task.userId,
            task.payload,
          );
          break;
        case 'read':
          await this.deliveryService.broadcastNotificationRead(
            task.userId,
            task.payload.notificationIds,
          );
          break;
        default:
          this.logger.warn(
            `Unknown delivery task type: ${(task as NotificationDeliveryTask).type}`,
          );
      }
    } catch (error) {
      this.logger.error(`Failed to process delivery task: ${error}`);
      // Don't throw - delivery failures shouldn't block the queue
    }
  }
}
