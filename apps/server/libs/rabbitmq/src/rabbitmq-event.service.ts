import { Injectable, Logger } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import {
  RABBITMQ_EXCHANGES,
  RABBITMQ_ROUTING_KEYS,
  RABBITMQ_QUEUES,
} from './constants/queues.js';
import type { NotificationTask, NotificationDeliveryTask } from '@team9/shared';

export interface WorkspaceMemberEvent {
  workspaceId: string;
  userId: string;
  eventType: string;
  payload: unknown;
  timestamp: Date;
}

@Injectable()
export class RabbitMQEventService {
  private readonly logger = new Logger(RabbitMQEventService.name);

  constructor(private readonly amqpConnection: AmqpConnection) {}

  /**
   * Send workspace event to offline users' queues
   * @param workspaceId - workspace ID
   * @param offlineUserIds - list of offline user IDs
   * @param event - event name
   * @param payload - event data
   */
  async sendToOfflineUsers(
    workspaceId: string,
    offlineUserIds: string[],
    event: string,
    payload: unknown,
  ): Promise<void> {
    const message: WorkspaceMemberEvent = {
      workspaceId,
      userId: '', // will be set in the loop
      eventType: event,
      payload,
      timestamp: new Date(),
    };

    const channel = this.amqpConnection.channel;

    // Send message to each offline user's queue
    for (const userId of offlineUserIds) {
      message.userId = userId;
      const queueName = RABBITMQ_QUEUES.USER_OFFLINE_MESSAGES(userId);
      const routingKey = this.getRoutingKey(userId);

      try {
        // Ensure queue exists and is bound to exchange
        await channel.assertQueue(queueName, {
          durable: true,
          autoDelete: false,
        });
        await channel.bindQueue(
          queueName,
          RABBITMQ_EXCHANGES.WORKSPACE_EVENTS,
          routingKey,
        );

        // Publish message to exchange
        await this.amqpConnection.publish(
          RABBITMQ_EXCHANGES.WORKSPACE_EVENTS,
          routingKey,
          message,
          {
            persistent: true, // Message persistence
            expiration: (15 * 24 * 60 * 60 * 1000).toString(), // 15 days expiration
          },
        );
        this.logger.debug(
          `Queued ${event} to offline user ${userId} in workspace ${workspaceId}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to queue message for user ${userId}: ${error}`,
        );
      }
    }
  }

  /**
   * Get offline messages for a user
   * @param userId - user ID
   * @param limit - maximum number of messages to retrieve
   */
  async getOfflineMessages(
    userId: string,
    limit = 100,
  ): Promise<WorkspaceMemberEvent[]> {
    const queueName = RABBITMQ_QUEUES.USER_OFFLINE_MESSAGES(userId);
    const messages: WorkspaceMemberEvent[] = [];

    try {
      // Get channel from connection
      const channel = this.amqpConnection.channel;

      // Ensure queue exists
      await channel.assertQueue(queueName, {
        durable: true,
        autoDelete: false,
      });

      // Get messages from queue
      let messageCount = 0;
      while (messageCount < limit) {
        const msg = await channel.get(queueName, { noAck: false });

        if (!msg) {
          // No more messages
          break;
        }

        try {
          const content = JSON.parse(msg.content.toString());
          messages.push(content);

          // Acknowledge the message (remove from queue)
          channel.ack(msg);
          messageCount++;
        } catch (error) {
          this.logger.error(`Failed to parse message: ${error}`);
          // Reject and requeue the message
          channel.nack(msg, false, true);
        }
      }

      this.logger.log(
        `Retrieved ${messages.length} offline messages for user ${userId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to get offline messages for user ${userId}: ${error}`,
      );
    }

    return messages;
  }

  /**
   * Ensure queues and exchanges are set up
   * Note: Exchanges are now declared in RabbitmqModule configuration.
   */
  async setupQueuesAndExchanges(): Promise<void> {
    try {
      await this.waitForConnection();
      this.logger.log('RabbitMQ exchanges already configured in module');
    } catch (error) {
      this.logger.error(`Failed to setup RabbitMQ: ${error}`);
    }
  }

  /**
   * Wait for RabbitMQ connection to be initialized
   */
  private async waitForConnection(maxRetries = 10, delay = 500): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      if (this.amqpConnection.managedConnection.isConnected()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    throw new Error('RabbitMQ connection timeout');
  }

  /**
   * Get routing key for offline message delivery
   */
  private getRoutingKey(userId: string): string {
    // Use user-specific routing key for offline message delivery
    // Format: user.offline.{userId}
    return `user.offline.${userId}`;
  }

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
   * Setup notification queue bindings
   * Note: Exchange is declared in RabbitmqModule configuration.
   */
  async setupNotificationExchange(): Promise<void> {
    try {
      await this.waitForConnection();
      const channel = this.amqpConnection.channel;

      // Declare notification tasks queue
      await channel.assertQueue(RABBITMQ_QUEUES.NOTIFICATION_TASKS, {
        durable: true,
      });

      // Bind queue to exchange with wildcard routing key
      await channel.bindQueue(
        RABBITMQ_QUEUES.NOTIFICATION_TASKS,
        RABBITMQ_EXCHANGES.NOTIFICATION_EVENTS,
        'notification.#',
      );

      this.logger.log('Notification queue bindings set up successfully');
    } catch (error) {
      this.logger.error(`Failed to setup notification queue: ${error}`);
    }
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

  /**
   * Setup notification delivery queue bindings
   * Note: Exchange is declared in RabbitmqModule configuration.
   */
  async setupDeliveryExchange(): Promise<void> {
    try {
      await this.waitForConnection();
      const channel = this.amqpConnection.channel;

      // Declare delivery queue
      await channel.assertQueue(RABBITMQ_QUEUES.NOTIFICATION_DELIVERY, {
        durable: true,
      });

      // Bind queue to exchange with wildcard routing key
      await channel.bindQueue(
        RABBITMQ_QUEUES.NOTIFICATION_DELIVERY,
        RABBITMQ_EXCHANGES.NOTIFICATION_DELIVERY,
        'delivery.#',
      );

      this.logger.log(
        'Notification delivery queue bindings set up successfully',
      );
    } catch (error) {
      this.logger.error(`Failed to setup delivery queue: ${error}`);
    }
  }
}
