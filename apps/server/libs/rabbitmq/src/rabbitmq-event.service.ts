import { Injectable, Logger } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import {
  RABBITMQ_EXCHANGES,
  RABBITMQ_ROUTING_KEYS,
  RABBITMQ_QUEUES,
} from './constants/queues.js';

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

    // Send message to each offline user's queue
    for (const userId of offlineUserIds) {
      message.userId = userId;

      try {
        await this.amqpConnection.publish(
          RABBITMQ_EXCHANGES.WORKSPACE_EVENTS,
          this.getRoutingKey(event, userId),
          message,
          {
            persistent: true, // Message persistence
            expiration: (7 * 24 * 60 * 60 * 1000).toString(), // 7 days expiration
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
   */
  async setupQueuesAndExchanges(): Promise<void> {
    try {
      // Wait for connection to be initialized
      await this.waitForConnection();

      const channel = this.amqpConnection.channel;

      // Declare workspace events exchange
      await channel.assertExchange(
        RABBITMQ_EXCHANGES.WORKSPACE_EVENTS,
        'topic',
        {
          durable: true,
        },
      );

      this.logger.log('RabbitMQ queues and exchanges set up successfully');
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
   * Get routing key for an event
   */
  private getRoutingKey(event: string, userId: string): string {
    const routingKeyMap: Record<string, string> = {
      workspace_member_joined: RABBITMQ_ROUTING_KEYS.WORKSPACE_MEMBER_JOINED,
      workspace_member_left: RABBITMQ_ROUTING_KEYS.WORKSPACE_MEMBER_LEFT,
      user_online: RABBITMQ_ROUTING_KEYS.USER_ONLINE,
      user_offline: RABBITMQ_ROUTING_KEYS.USER_OFFLINE,
    };

    const baseKey = routingKeyMap[event] || 'workspace.unknown';
    return `${baseKey}.${userId}`;
  }
}
