import { Injectable, Logger } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import {
  RABBITMQ_EXCHANGES,
  RABBITMQ_ROUTING_KEYS,
} from './constants/queues.js';
import type { NotificationTask, NotificationDeliveryTask } from '@team9/shared';

// Note: Offline message handling has been migrated to SeqId-based incremental sync.
// Messages are now synced via GET /v1/im/sync/channel/:channelId when user opens a channel.
// See: apps/server/apps/gateway/src/im/sync/sync.service.ts

@Injectable()
export class RabbitMQEventService {
  private readonly logger = new Logger(RabbitMQEventService.name);

  constructor(private readonly amqpConnection: AmqpConnection) {}

  /**
   * Publish a notification task to be processed by Gateway
   * @param task - notification task to publish
   */
  async publishNotificationTask(task: NotificationTask): Promise<void> {
    try {
      const routingKey = this.getNotificationRoutingKey(task.type);

      await this.amqpConnection.publish(
        RABBITMQ_EXCHANGES.NOTIFICATION_EVENTS,
        routingKey,
        task,
        {
          persistent: true,
        },
      );

      this.logger.debug(
        `Published notification task: ${task.type} with routing key: ${routingKey}`,
      );
    } catch (error) {
      this.logger.error(`Failed to publish notification task: ${error}`);
      throw error;
    }
  }

  /**
   * Get routing key for notification type
   */
  private getNotificationRoutingKey(type: NotificationTask['type']): string {
    const routingKeyMap: Record<string, string> = {
      mention: RABBITMQ_ROUTING_KEYS.NOTIFICATION_MENTION,
      reply: RABBITMQ_ROUTING_KEYS.NOTIFICATION_REPLY,
      dm: RABBITMQ_ROUTING_KEYS.NOTIFICATION_DM,
      workspace_invitation: RABBITMQ_ROUTING_KEYS.NOTIFICATION_WORKSPACE,
      member_joined: RABBITMQ_ROUTING_KEYS.NOTIFICATION_WORKSPACE,
      role_changed: RABBITMQ_ROUTING_KEYS.NOTIFICATION_WORKSPACE,
    };

    return routingKeyMap[type] || 'notification.unknown';
  }

  /**
   * Publish a notification delivery task to Gateway for WebSocket push
   * @param task - delivery task to publish
   */
  async publishDeliveryTask(task: NotificationDeliveryTask): Promise<void> {
    try {
      const routingKey = this.getDeliveryRoutingKey(task.type);

      await this.amqpConnection.publish(
        RABBITMQ_EXCHANGES.NOTIFICATION_DELIVERY,
        routingKey,
        task,
        {
          persistent: true,
        },
      );

      this.logger.debug(
        `Published delivery task: ${task.type} for user: ${task.userId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to publish delivery task: ${error}`);
      // Don't throw - delivery failures shouldn't block notification creation
    }
  }

  /**
   * Get routing key for delivery task type
   */
  private getDeliveryRoutingKey(
    type: NotificationDeliveryTask['type'],
  ): string {
    const routingKeyMap: Record<string, string> = {
      new: RABBITMQ_ROUTING_KEYS.DELIVERY_NEW,
      counts: RABBITMQ_ROUTING_KEYS.DELIVERY_COUNTS,
      read: RABBITMQ_ROUTING_KEYS.DELIVERY_READ,
    };

    return routingKeyMap[type] || 'delivery.unknown';
  }
}
