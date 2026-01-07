import { Injectable, Logger } from '@nestjs/common';
import { AmqpConnection } from '@team9/rabbitmq';
import { RedisService } from '@team9/redis';
import {
  MQ_EXCHANGES,
  MQ_ROUTING_KEYS,
  DownstreamMessage,
  IMMessageEnvelope,
} from '@team9/shared';

const REDIS_KEYS = {
  USER_ROUTE: (userId: string) => `im:route:user:${userId}`,
};

/**
 * Message Router Service - routes messages to appropriate Gateway nodes
 *
 * Responsibilities:
 * - Query user's Gateway from Redis
 * - Group users by Gateway
 * - Publish messages to Gateway queues
 */
@Injectable()
export class MessageRouterService {
  private readonly logger = new Logger(MessageRouterService.name);

  constructor(
    private readonly amqpConnection: AmqpConnection,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Route message to target users
   */
  async routeMessage(
    message: IMMessageEnvelope,
    targetUserIds: string[],
  ): Promise<{ online: string[]; offline: string[] }> {
    // Get user-to-gateway mapping
    const userGateways = await this.getUsersGateways(targetUserIds);

    const onlineUsers: string[] = [];
    const offlineUsers: string[] = [];

    // Separate online and offline users
    for (const userId of targetUserIds) {
      if (userGateways.has(userId)) {
        onlineUsers.push(userId);
      } else {
        offlineUsers.push(userId);
      }
    }

    // Group online users by gateway
    const gatewayUsers = new Map<string, string[]>();
    for (const userId of onlineUsers) {
      const gatewayId = userGateways.get(userId)!;
      const users = gatewayUsers.get(gatewayId) || [];
      users.push(userId);
      gatewayUsers.set(gatewayId, users);
    }

    // Send to each gateway
    for (const [gatewayId, users] of gatewayUsers) {
      await this.sendToGateway(gatewayId, message, users);
    }

    this.logger.debug(
      `Routed message ${message.msgId}: online=${onlineUsers.length}, offline=${offlineUsers.length}`,
    );

    return { online: onlineUsers, offline: offlineUsers };
  }

  /**
   * Send message to a specific gateway
   */
  async sendToGateway(
    gatewayId: string,
    message: IMMessageEnvelope,
    targetUserIds: string[],
  ): Promise<void> {
    const downstreamMessage: DownstreamMessage = {
      ...message,
      targetUserIds,
      targetGatewayIds: [gatewayId],
    };

    await this.amqpConnection.publish(
      MQ_EXCHANGES.IM_TOPIC,
      MQ_ROUTING_KEYS.TO_GATEWAY(gatewayId),
      downstreamMessage,
      {
        persistent: true,
        timestamp: Date.now(),
      },
    );

    this.logger.debug(
      `Sent message to gateway ${gatewayId} for ${targetUserIds.length} users`,
    );
  }

  /**
   * Broadcast message to all gateways (for large groups)
   */
  async broadcastToAllGateways(
    message: IMMessageEnvelope,
    targetUserIds: string[],
  ): Promise<void> {
    const downstreamMessage: DownstreamMessage = {
      ...message,
      targetUserIds,
      targetGatewayIds: [], // Empty means broadcast
    };

    await this.amqpConnection.publish(
      MQ_EXCHANGES.IM_BROADCAST,
      '', // Fanout ignores routing key
      downstreamMessage,
      {
        persistent: true,
        timestamp: Date.now(),
      },
    );

    this.logger.debug(`Broadcast message to all gateways`);
  }

  /**
   * Get gateways for multiple users
   */
  private async getUsersGateways(
    userIds: string[],
  ): Promise<Map<string, string>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const client = this.redisService.getClient();
    const pipeline = client.pipeline();

    for (const userId of userIds) {
      pipeline.hget(REDIS_KEYS.USER_ROUTE(userId), 'gatewayId');
    }

    const results = await pipeline.exec();
    const gatewayMap = new Map<string, string>();

    results?.forEach((result, index) => {
      const [err, gatewayId] = result;
      if (!err && gatewayId) {
        gatewayMap.set(userIds[index], gatewayId as string);
      }
    });

    return gatewayMap;
  }

  /**
   * Check if user is online
   */
  async isUserOnline(userId: string): Promise<boolean> {
    const exists = await this.redisService.exists(
      REDIS_KEYS.USER_ROUTE(userId),
    );
    return exists === 1;
  }
}
