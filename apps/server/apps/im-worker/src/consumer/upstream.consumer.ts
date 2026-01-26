import { Injectable, Logger, Optional } from '@nestjs/common';
import { RabbitSubscribe, Nack } from '@team9/rabbitmq';
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
 * Uses a single queue with internal routing by message type.
 * This avoids the round-robin distribution issue in @golevelup/nestjs-rabbitmq
 * where multiple handlers sharing the same queue receive messages randomly.
 */
@Injectable()
export class UpstreamConsumer {
  private readonly logger = new Logger(UpstreamConsumer.name);

  constructor(
    private readonly messageService: MessageService,
    private readonly ackService: AckService,
    private readonly routerService: MessageRouterService,
    @Optional() private readonly postBroadcastService?: PostBroadcastService,
  ) {}

  /**
   * Main upstream message handler - routes by message type internally
   */
  @RabbitSubscribe({
    exchange: MQ_EXCHANGES.IM_UPSTREAM,
    routingKey: [
      MQ_ROUTING_KEYS.UPSTREAM.MESSAGE,
      MQ_ROUTING_KEYS.UPSTREAM.ACK,
      MQ_ROUTING_KEYS.UPSTREAM.TYPING,
      MQ_ROUTING_KEYS.UPSTREAM.READ,
      MQ_ROUTING_KEYS.UPSTREAM.PRESENCE,
    ],
    queue: MQ_QUEUES.IM_WORKER_UPSTREAM,
    queueOptions: {
      durable: true,
      deadLetterExchange: MQ_EXCHANGES.IM_DLX,
      deadLetterRoutingKey: 'dlq.upstream',
    },
    errorHandler: (_channel, _msg, error) => {
      console.error(`[UpstreamConsumer] Error processing message: ${error}`);
    },
  })
  async handleUpstreamMessage(upstream: UpstreamMessage): Promise<void | Nack> {
    try {
      const { type } = upstream.message;

      switch (type) {
        case 'text':
        case 'file':
        case 'image':
        case 'system':
          return this.processContentMessage(upstream);

        case 'ack':
          return this.processAckMessage(upstream);

        case 'typing':
          return this.processTypingMessage(upstream);

        case 'read':
          return this.processReadMessage(upstream);

        case 'presence':
          return this.processPresenceMessage(upstream);

        default:
          this.logger.warn(`Unknown message type: ${type}`);
      }
    } catch (error) {
      this.logger.error(`Failed to process upstream message: ${error}`);
      return new Nack(false);
    }
  }

  /**
   * Process content messages (text, file, image, system) - stored in database
   */
  private async processContentMessage(
    upstream: UpstreamMessage,
  ): Promise<void> {
    const response = await this.messageService.processUpstreamMessage(upstream);
    this.logger.debug(
      `Processed content message: ${response.msgId}, status: ${response.status}`,
    );
  }

  /**
   * Process ACK messages from client
   */
  private async processAckMessage(upstream: UpstreamMessage): Promise<void> {
    await this.ackService.handleClientAck(upstream);
  }

  /**
   * Process typing indicators - forwarded without storage
   */
  private async processTypingMessage(upstream: UpstreamMessage): Promise<void> {
    this.logger.debug(
      `Typing indicator from ${upstream.userId} in ${upstream.message.targetId}`,
    );
    // TODO: Forward to channel members via router
  }

  /**
   * Process read status updates
   */
  private async processReadMessage(upstream: UpstreamMessage): Promise<void> {
    await this.ackService.handleReadStatus(upstream);
  }

  /**
   * Process presence (online/offline) events
   * When a user comes online, deliver any unread messages
   */
  private async processPresenceMessage(
    upstream: UpstreamMessage,
  ): Promise<void> {
    const { userId, gatewayId } = upstream;
    const payload = upstream.message.payload as PresencePayload;

    if (payload.event === 'online') {
      this.logger.log(`User ${userId} came online on gateway ${gatewayId}`);

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
    } else if (payload.event === 'offline') {
      this.logger.debug(`User ${userId} went offline`);
    }
  }

  /**
   * Handle post-broadcast tasks (separate queue for isolation)
   * Processes offline messages and unread counts after Gateway broadcast
   */
  @RabbitSubscribe({
    exchange: MQ_EXCHANGES.IM_UPSTREAM,
    routingKey: MQ_ROUTING_KEYS.UPSTREAM.POST_BROADCAST,
    queue: MQ_QUEUES.POST_BROADCAST,
    queueOptions: {
      durable: true,
      deadLetterExchange: MQ_EXCHANGES.IM_DLX,
      deadLetterRoutingKey: 'dlq.post_broadcast',
    },
  })
  async handlePostBroadcastTask(task: PostBroadcastTask): Promise<void | Nack> {
    try {
      if (!this.postBroadcastService) {
        this.logger.warn('PostBroadcastService not available, skipping task');
        return;
      }

      await this.postBroadcastService.processTask(task);
    } catch (error) {
      this.logger.error(`Failed to process post-broadcast task: ${error}`);
      return new Nack(false);
    }
  }
}
