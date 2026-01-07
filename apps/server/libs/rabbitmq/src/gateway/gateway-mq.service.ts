import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  MQ_EXCHANGES,
  MQ_QUEUES,
  MQ_ROUTING_KEYS,
  MQ_CONFIG,
  DownstreamMessage,
  UpstreamMessage,
  PostBroadcastTask,
} from '@team9/shared';

/**
 * Gateway MQ Service - handles RabbitMQ communication for Gateway nodes
 *
 * Responsibilities:
 * - Create and manage Gateway-specific queue
 * - Consume downstream messages from Logic Service
 * - Publish upstream messages to Logic Service
 */
@Injectable()
export class GatewayMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GatewayMQService.name);

  private nodeId: string | null = null;
  private queueName: string | null = null;
  private consumerTag: string | null = null;
  private isInitialized = false;

  constructor(
    private readonly amqpConnection: AmqpConnection,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit(): Promise<void> {
    // Wait for RabbitMQ connection
    await this.waitForConnection();

    // Setup exchanges (idempotent)
    await this.setupExchanges();

    this.logger.log('GatewayMQService initialized, waiting for node ID');
  }

  async onModuleDestroy(): Promise<void> {
    await this.cleanup();
  }

  /**
   * Initialize the Gateway queue with the node ID
   * This should be called after ClusterNodeService is initialized
   */
  async initializeForNode(nodeId: string): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn(`Already initialized for node ${this.nodeId}`);
      return;
    }

    this.nodeId = nodeId;
    this.queueName = MQ_QUEUES.GATEWAY(nodeId);

    await this.setupQueue();
    await this.startConsuming();

    this.isInitialized = true;
    this.logger.log(`GatewayMQService initialized for node: ${nodeId}`);
  }

  /**
   * Wait for RabbitMQ connection to be ready
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
   * Setup RabbitMQ exchanges
   */
  private async setupExchanges(): Promise<void> {
    const channel = this.amqpConnection.channel;

    // Topic exchange for downstream messages
    await channel.assertExchange(MQ_EXCHANGES.IM_TOPIC, 'topic', {
      durable: true,
    });

    // Direct exchange for upstream messages
    await channel.assertExchange(MQ_EXCHANGES.IM_UPSTREAM, 'direct', {
      durable: true,
    });

    // Dead letter exchange
    await channel.assertExchange(MQ_EXCHANGES.IM_DLX, 'direct', {
      durable: true,
    });

    // Fanout exchange for broadcast
    await channel.assertExchange(MQ_EXCHANGES.IM_BROADCAST, 'fanout', {
      durable: true,
    });

    this.logger.log('RabbitMQ exchanges setup completed');
  }

  /**
   * Setup Gateway-specific queue
   */
  private async setupQueue(): Promise<void> {
    if (!this.queueName || !this.nodeId) {
      throw new Error('Node ID not set');
    }

    const channel = this.amqpConnection.channel;

    // Declare Gateway queue with auto-delete (removed when node goes down)
    await channel.assertQueue(this.queueName, {
      durable: true,
      autoDelete: true, // Delete queue when consumer disconnects
      arguments: {
        'x-message-ttl': MQ_CONFIG.GATEWAY_MESSAGE_TTL,
        'x-dead-letter-exchange': MQ_EXCHANGES.IM_DLX,
        'x-dead-letter-routing-key': 'dlq',
      },
    });

    // Bind to topic exchange with node-specific routing key
    await channel.bindQueue(
      this.queueName,
      MQ_EXCHANGES.IM_TOPIC,
      MQ_ROUTING_KEYS.TO_GATEWAY(this.nodeId),
    );

    // Also bind to broadcast exchange for group messages
    await channel.bindQueue(
      this.queueName,
      MQ_EXCHANGES.IM_BROADCAST,
      '', // Fanout exchange ignores routing key
    );

    this.logger.log(`Queue ${this.queueName} setup and bound`);
  }

  /**
   * Start consuming messages from the Gateway queue
   */
  private async startConsuming(): Promise<void> {
    if (!this.queueName) {
      throw new Error('Queue name not set');
    }

    const channel = this.amqpConnection.channel;

    const { consumerTag } = await channel.consume(
      this.queueName,
      async (msg) => {
        if (!msg) return;

        try {
          const content: DownstreamMessage = JSON.parse(msg.content.toString());

          // Emit event for WebSocket gateway to handle
          this.eventEmitter.emit('im.downstream.message', content);

          // Acknowledge the message
          channel.ack(msg);

          this.logger.debug(`Processed downstream message: ${content.msgId}`);
        } catch (error) {
          this.logger.error(`Failed to process message: ${error}`);

          // Check retry count
          const retryCount =
            (msg.properties.headers?.['x-retry-count'] || 0) + 1;

          if (retryCount < MQ_CONFIG.MAX_RETRY_COUNT) {
            // Requeue for retry
            channel.nack(msg, false, true);
          } else {
            // Send to DLQ
            channel.nack(msg, false, false);
          }
        }
      },
      { noAck: false },
    );

    this.consumerTag = consumerTag;
    this.logger.log(`Started consuming from ${this.queueName}`);
  }

  /**
   * Publish upstream message to Logic Service
   */
  async publishUpstream(message: UpstreamMessage): Promise<void> {
    if (!this.nodeId) {
      throw new Error('Node ID not set');
    }

    // Determine routing key based on message type
    let routingKey: string;
    switch (message.message.type) {
      case 'ack':
        routingKey = MQ_ROUTING_KEYS.UPSTREAM.ACK;
        break;
      case 'typing':
        routingKey = MQ_ROUTING_KEYS.UPSTREAM.TYPING;
        break;
      case 'read':
        routingKey = MQ_ROUTING_KEYS.UPSTREAM.READ;
        break;
      default:
        routingKey = MQ_ROUTING_KEYS.UPSTREAM.MESSAGE;
    }

    await this.amqpConnection.publish(
      MQ_EXCHANGES.IM_UPSTREAM,
      routingKey,
      message,
      {
        persistent: true,
        timestamp: Date.now(),
        headers: {
          'x-gateway-id': this.nodeId,
        },
      },
    );

    this.logger.debug(
      `Published upstream message: ${message.message.type} from user ${message.userId}`,
    );
  }

  /**
   * Publish post-broadcast task to Logic Service
   * Called after Gateway broadcasts to online users
   * Handles: offline messages, unread counts, outbox completion
   */
  async publishPostBroadcast(task: PostBroadcastTask): Promise<void> {
    if (!this.nodeId) {
      throw new Error('Node ID not set');
    }

    await this.amqpConnection.publish(
      MQ_EXCHANGES.IM_UPSTREAM,
      MQ_ROUTING_KEYS.UPSTREAM.POST_BROADCAST,
      task,
      {
        persistent: true,
        timestamp: Date.now(),
        headers: {
          'x-gateway-id': this.nodeId,
        },
      },
    );

    this.logger.debug(
      `Published post-broadcast task for message: ${task.msgId}`,
    );
  }

  /**
   * Cleanup resources
   */
  private async cleanup(): Promise<void> {
    const channel = this.amqpConnection.channel;

    if (this.consumerTag) {
      try {
        await channel.cancel(this.consumerTag);
        this.logger.log('Consumer cancelled');
      } catch (error) {
        this.logger.error(`Failed to cancel consumer: ${error}`);
      }
    }

    // Queue will auto-delete when consumer disconnects
    this.logger.log('GatewayMQService cleanup completed');
  }

  /**
   * Get current node ID
   */
  getNodeId(): string | null {
    return this.nodeId;
  }

  /**
   * Check if service is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}
