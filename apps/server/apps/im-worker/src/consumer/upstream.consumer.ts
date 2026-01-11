import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { AmqpConnection } from '@team9/rabbitmq';
import { MQ_EXCHANGES, MQ_QUEUES, MQ_ROUTING_KEYS } from '@team9/shared';
import type {
  UpstreamMessage,
  PresencePayload,
  PostBroadcastTask,
} from '@team9/shared';
import { MessageService } from '../message/message.service.js';
import { AckService } from '../ack/ack.service.js';
import { MessageRouterService } from '../message/message-router.service.js';
import { PostBroadcastService } from '../post-broadcast/post-broadcast.service.js';

/**
 * Upstream Consumer - consumes messages from Gateway nodes
 *
 * Listens to:
 * - im.queue.im-worker.upstream - all upstream messages including:
 *   - Regular messages (text, file, image)
 *   - ACK, typing, read, presence events
 *   - Post-broadcast tasks (offline message handling)
 */
@Injectable()
export class UpstreamConsumer implements OnModuleInit {
  private readonly logger = new Logger(UpstreamConsumer.name);
  private consumerTag: string | null = null;

  constructor(
    private readonly amqpConnection: AmqpConnection,
    private readonly messageService: MessageService,
    private readonly ackService: AckService,
    private readonly routerService: MessageRouterService,
    @Optional() private readonly postBroadcastService?: PostBroadcastService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.setupQueue();
    await this.startConsuming();
    this.logger.log('Upstream consumer started');
  }

  /**
   * Setup the upstream queue
   */
  private async setupQueue(): Promise<void> {
    const channel = this.amqpConnection.channel;

    // Ensure exchange exists
    await channel.assertExchange(MQ_EXCHANGES.IM_UPSTREAM, 'direct', {
      durable: true,
    });

    // Create upstream queue
    await channel.assertQueue(MQ_QUEUES.IM_WORKER_UPSTREAM, {
      durable: true,
      autoDelete: false,
    });

    // Bind to all upstream routing keys
    const routingKeys = Object.values(MQ_ROUTING_KEYS.UPSTREAM);
    for (const key of routingKeys) {
      await channel.bindQueue(
        MQ_QUEUES.IM_WORKER_UPSTREAM,
        MQ_EXCHANGES.IM_UPSTREAM,
        key,
      );
    }

    this.logger.log('Upstream queue setup complete');
  }

  /**
   * Start consuming upstream messages
   */
  private async startConsuming(): Promise<void> {
    const channel = this.amqpConnection.channel;

    const { consumerTag } = await channel.consume(
      MQ_QUEUES.IM_WORKER_UPSTREAM,
      async (msg) => {
        if (!msg) return;

        try {
          const routingKey = msg.fields.routingKey;

          // Handle post-broadcast tasks separately
          if (routingKey === MQ_ROUTING_KEYS.UPSTREAM.POST_BROADCAST) {
            const task: PostBroadcastTask = JSON.parse(msg.content.toString());
            await this.handlePostBroadcastTask(task);
          } else {
            const upstream: UpstreamMessage = JSON.parse(
              msg.content.toString(),
            );
            await this.handleUpstreamMessage(upstream);
          }

          channel.ack(msg);
        } catch (error) {
          this.logger.error(`Failed to process upstream message: ${error}`);

          // Determine if we should retry
          const retryCount =
            (msg.properties.headers?.['x-retry-count'] || 0) + 1;

          if (retryCount < 3) {
            channel.nack(msg, false, true);
          } else {
            channel.nack(msg, false, false);
            this.logger.error('Message moved to DLQ after 3 retries');
          }
        }
      },
      { noAck: false },
    );

    this.consumerTag = consumerTag;
  }

  /**
   * Handle post-broadcast task (event-driven, replaces polling)
   * Processes offline messages and unread counts after Gateway broadcast
   */
  private async handlePostBroadcastTask(
    task: PostBroadcastTask,
  ): Promise<void> {
    if (!this.postBroadcastService) {
      this.logger.warn('PostBroadcastService not available, skipping task');
      return;
    }

    await this.postBroadcastService.processTask(task);
  }

  /**
   * Handle upstream message based on type
   */
  private async handleUpstreamMessage(
    upstream: UpstreamMessage,
  ): Promise<void> {
    const { message } = upstream;

    switch (message.type) {
      case 'text':
      case 'file':
      case 'image':
        await this.handleContentMessage(upstream);
        break;

      case 'ack':
        await this.handleAckMessage(upstream);
        break;

      case 'typing':
        await this.handleTypingMessage(upstream);
        break;

      case 'read':
        await this.handleReadMessage(upstream);
        break;

      case 'presence':
        await this.handlePresenceMessage(upstream);
        break;

      default:
        this.logger.warn(`Unknown message type: ${message.type}`);
    }
  }

  /**
   * Handle content message (text, file, image)
   */
  private async handleContentMessage(upstream: UpstreamMessage): Promise<void> {
    const response = await this.messageService.processUpstreamMessage(upstream);

    // Send ACK response back to sender via their gateway
    // This would be done through the router service
    this.logger.debug(
      `Processed content message: ${response.msgId}, status: ${response.status}`,
    );
  }

  /**
   * Handle ACK message from client
   */
  private async handleAckMessage(upstream: UpstreamMessage): Promise<void> {
    await this.ackService.handleClientAck(upstream);
  }

  /**
   * Handle typing indicator
   */
  private async handleTypingMessage(upstream: UpstreamMessage): Promise<void> {
    // Typing messages are forwarded immediately to channel members
    // without database storage
    this.logger.debug(
      `Typing indicator from ${upstream.userId} in ${upstream.message.targetId}`,
    );

    // Route typing indicator to other channel members
    // This is handled similarly to regular messages but without storage
  }

  /**
   * Handle read status update
   */
  private async handleReadMessage(upstream: UpstreamMessage): Promise<void> {
    await this.ackService.handleReadStatus(upstream);
  }

  /**
   * Handle user presence (online/offline) events
   * When a user comes online, deliver any unread messages
   */
  private async handlePresenceMessage(
    upstream: UpstreamMessage,
  ): Promise<void> {
    const { userId, gatewayId } = upstream;
    const payload = upstream.message.payload as PresencePayload;

    if (payload.event === 'online') {
      this.logger.log(`User ${userId} came online on gateway ${gatewayId}`);

      try {
        // Get unread messages for this user
        const unreadMessages =
          await this.messageService.getUndeliveredMessages(userId);

        if (unreadMessages.length > 0) {
          this.logger.log(
            `Delivering ${unreadMessages.length} unread messages to user ${userId}`,
          );

          // Send unread messages to the user via their gateway
          for (const msg of unreadMessages) {
            await this.routerService.sendToGateway(gatewayId, msg, [userId]);
          }
        }
      } catch (error) {
        this.logger.error(
          `Failed to deliver offline messages to user ${userId}: ${error}`,
        );
      }
    } else if (payload.event === 'offline') {
      this.logger.debug(`User ${userId} went offline`);
      // Additional offline handling can be added here if needed
    }
  }
}
