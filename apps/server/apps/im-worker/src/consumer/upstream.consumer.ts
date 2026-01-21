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
 * Uses @RabbitSubscribe decorators for each message type:
 * - Regular messages (text, file, image)
 * - ACK, typing, read, presence events
 * - Post-broadcast tasks (offline message handling)
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
   * Handle regular content messages (text, file, image)
   */
  @RabbitSubscribe({
    exchange: MQ_EXCHANGES.IM_UPSTREAM,
    routingKey: MQ_ROUTING_KEYS.UPSTREAM.MESSAGE,
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
  async handleContentMessage(upstream: UpstreamMessage): Promise<void | Nack> {
    try {
      const response =
        await this.messageService.processUpstreamMessage(upstream);
      this.logger.debug(
        `Processed content message: ${response.msgId}, status: ${response.status}`,
      );
    } catch (error) {
      this.logger.error(`Failed to process content message: ${error}`);
      return new Nack(false);
    }
  }

  /**
   * Handle ACK messages from client
   */
  @RabbitSubscribe({
    exchange: MQ_EXCHANGES.IM_UPSTREAM,
    routingKey: MQ_ROUTING_KEYS.UPSTREAM.ACK,
    queue: MQ_QUEUES.IM_WORKER_UPSTREAM,
    queueOptions: {
      durable: true,
      deadLetterExchange: MQ_EXCHANGES.IM_DLX,
      deadLetterRoutingKey: 'dlq.upstream',
    },
  })
  async handleAckMessage(upstream: UpstreamMessage): Promise<void | Nack> {
    try {
      await this.ackService.handleClientAck(upstream);
    } catch (error) {
      this.logger.error(`Failed to process ACK message: ${error}`);
      return new Nack(false);
    }
  }

  /**
   * Handle typing indicators
   */
  @RabbitSubscribe({
    exchange: MQ_EXCHANGES.IM_UPSTREAM,
    routingKey: MQ_ROUTING_KEYS.UPSTREAM.TYPING,
    queue: MQ_QUEUES.IM_WORKER_UPSTREAM,
    queueOptions: {
      durable: true,
      deadLetterExchange: MQ_EXCHANGES.IM_DLX,
      deadLetterRoutingKey: 'dlq.upstream',
    },
  })
  async handleTypingMessage(upstream: UpstreamMessage): Promise<void | Nack> {
    try {
      // Typing messages are forwarded immediately to channel members
      // without database storage
      this.logger.debug(
        `Typing indicator from ${upstream.userId} in ${upstream.message.targetId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to process typing message: ${error}`);
      return new Nack(false);
    }
  }

  /**
   * Handle read status updates
   */
  @RabbitSubscribe({
    exchange: MQ_EXCHANGES.IM_UPSTREAM,
    routingKey: MQ_ROUTING_KEYS.UPSTREAM.READ,
    queue: MQ_QUEUES.IM_WORKER_UPSTREAM,
    queueOptions: {
      durable: true,
      deadLetterExchange: MQ_EXCHANGES.IM_DLX,
      deadLetterRoutingKey: 'dlq.upstream',
    },
  })
  async handleReadMessage(upstream: UpstreamMessage): Promise<void | Nack> {
    try {
      await this.ackService.handleReadStatus(upstream);
    } catch (error) {
      this.logger.error(`Failed to process read message: ${error}`);
      return new Nack(false);
    }
  }

  /**
   * Handle user presence (online/offline) events
   * When a user comes online, deliver any unread messages
   */
  @RabbitSubscribe({
    exchange: MQ_EXCHANGES.IM_UPSTREAM,
    routingKey: MQ_ROUTING_KEYS.UPSTREAM.PRESENCE,
    queue: MQ_QUEUES.IM_WORKER_UPSTREAM,
    queueOptions: {
      durable: true,
      deadLetterExchange: MQ_EXCHANGES.IM_DLX,
      deadLetterRoutingKey: 'dlq.upstream',
    },
  })
  async handlePresenceMessage(upstream: UpstreamMessage): Promise<void | Nack> {
    try {
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
    } catch (error) {
      this.logger.error(`Failed to process presence message: ${error}`);
      return new Nack(false);
    }
  }

  /**
   * Handle post-broadcast tasks (event-driven, replaces polling)
   * Processes offline messages and unread counts after Gateway broadcast
   *
   * Note: Uses a separate queue (POST_BROADCAST) from the main upstream queue
   * to avoid message routing issues with @golevelup/nestjs-rabbitmq.
   * When multiple handlers share the same queue, messages are distributed
   * round-robin instead of by routing key.
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
