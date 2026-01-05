import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@team9/redis';
import { REDIS_KEYS } from '../../im/shared/constants/redis-keys.js';
import { UserSession, GatewayNodeInfo } from '@team9/shared';

/**
 * Session Service - manages user sessions and routing information
 *
 * Responsibilities:
 * - Store and retrieve user session/route information
 * - Manage user-gateway mapping for message routing
 * - Handle heartbeat updates
 * - Detect zombie sessions
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  // Session TTL: 5 minutes (heartbeat will renew)
  private readonly SESSION_TTL = 300;

  // Node info TTL: 30 seconds (needs periodic renewal)
  private readonly NODE_TTL = 30;

  constructor(private readonly redisService: RedisService) {}

  // ============ User Session Management ============

  /**
   * Set user session (called when user connects)
   */
  async setUserSession(userId: string, session: UserSession): Promise<void> {
    const key = REDIS_KEYS.USER_ROUTE(userId);
    const client = this.redisService.getClient();

    const pipeline = client.pipeline();

    // Store session as hash
    pipeline.hset(key, {
      gatewayId: session.gatewayId,
      socketId: session.socketId,
      loginTime: session.loginTime.toString(),
      lastActiveTime: session.lastActiveTime.toString(),
      deviceInfo: session.deviceInfo ? JSON.stringify(session.deviceInfo) : '',
    });

    // Set TTL
    pipeline.expire(key, this.SESSION_TTL);

    // Add to heartbeat check sorted set
    pipeline.zadd(
      REDIS_KEYS.HEARTBEAT_CHECK,
      session.lastActiveTime,
      `${userId}:${session.socketId}`,
    );

    await pipeline.exec();

    this.logger.debug(
      `User ${userId} session set on gateway ${session.gatewayId}`,
    );
  }

  /**
   * Get user session
   */
  async getUserSession(userId: string): Promise<UserSession | null> {
    const key = REDIS_KEYS.USER_ROUTE(userId);
    const data = await this.redisService.hgetall(key);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return {
      gatewayId: data.gatewayId,
      socketId: data.socketId,
      loginTime: parseInt(data.loginTime, 10),
      lastActiveTime: parseInt(data.lastActiveTime, 10),
      deviceInfo: data.deviceInfo ? JSON.parse(data.deviceInfo) : undefined,
    };
  }

  /**
   * Remove user session (called when user disconnects)
   */
  async removeUserSession(userId: string, socketId: string): Promise<void> {
    const key = REDIS_KEYS.USER_ROUTE(userId);
    const client = this.redisService.getClient();

    // Verify this is the same session (prevent removing newer session)
    const currentSocketId = await this.redisService.hget(key, 'socketId');
    if (currentSocketId !== socketId) {
      this.logger.debug(
        `Session mismatch for user ${userId}: current=${currentSocketId}, removing=${socketId}`,
      );
      // Just remove from heartbeat check
      await client.zrem(REDIS_KEYS.HEARTBEAT_CHECK, `${userId}:${socketId}`);
      return;
    }

    const pipeline = client.pipeline();
    pipeline.del(key);
    pipeline.zrem(REDIS_KEYS.HEARTBEAT_CHECK, `${userId}:${socketId}`);
    await pipeline.exec();

    this.logger.debug(`User ${userId} session removed`);
  }

  /**
   * Update heartbeat (called on ping/activity)
   */
  async updateHeartbeat(userId: string, socketId: string): Promise<boolean> {
    const key = REDIS_KEYS.USER_ROUTE(userId);
    const now = Date.now();

    // Verify session exists and matches
    const currentSocketId = await this.redisService.hget(key, 'socketId');
    if (currentSocketId !== socketId) {
      return false;
    }

    const client = this.redisService.getClient();
    const pipeline = client.pipeline();

    // Update last active time
    pipeline.hset(key, 'lastActiveTime', now.toString());

    // Renew TTL
    pipeline.expire(key, this.SESSION_TTL);

    // Update heartbeat check sorted set
    pipeline.zadd(REDIS_KEYS.HEARTBEAT_CHECK, now, `${userId}:${socketId}`);

    await pipeline.exec();

    return true;
  }

  // ============ Gateway Node Management ============

  /**
   * Register gateway node
   */
  async registerNode(nodeInfo: GatewayNodeInfo): Promise<void> {
    const key = REDIS_KEYS.GATEWAY_NODE(nodeInfo.nodeId);
    const client = this.redisService.getClient();

    const pipeline = client.pipeline();

    // Store node info
    pipeline.hset(key, {
      nodeId: nodeInfo.nodeId,
      address: nodeInfo.address,
      startTime: nodeInfo.startTime.toString(),
      lastHeartbeat: nodeInfo.lastHeartbeat.toString(),
      connectionCount: nodeInfo.connectionCount.toString(),
    });

    // Set TTL
    pipeline.expire(key, this.NODE_TTL);

    // Add to nodes set
    pipeline.sadd(REDIS_KEYS.GATEWAY_NODES, nodeInfo.nodeId);

    // Update connection count sorted set
    pipeline.zadd(
      REDIS_KEYS.GATEWAY_CONNECTIONS,
      nodeInfo.connectionCount,
      nodeInfo.nodeId,
    );

    await pipeline.exec();

    this.logger.log(`Gateway node ${nodeInfo.nodeId} registered`);
  }

  /**
   * Update node heartbeat
   */
  async updateNodeHeartbeat(
    nodeId: string,
    connectionCount: number,
  ): Promise<void> {
    const key = REDIS_KEYS.GATEWAY_NODE(nodeId);
    const now = Date.now();
    const client = this.redisService.getClient();

    const pipeline = client.pipeline();

    pipeline.hset(key, {
      lastHeartbeat: now.toString(),
      connectionCount: connectionCount.toString(),
    });
    pipeline.expire(key, this.NODE_TTL);
    pipeline.zadd(REDIS_KEYS.GATEWAY_CONNECTIONS, connectionCount, nodeId);

    await pipeline.exec();
  }

  /**
   * Unregister gateway node
   */
  async unregisterNode(nodeId: string): Promise<void> {
    const client = this.redisService.getClient();

    const pipeline = client.pipeline();
    pipeline.del(REDIS_KEYS.GATEWAY_NODE(nodeId));
    pipeline.srem(REDIS_KEYS.GATEWAY_NODES, nodeId);
    pipeline.zrem(REDIS_KEYS.GATEWAY_CONNECTIONS, nodeId);

    await pipeline.exec();

    this.logger.log(`Gateway node ${nodeId} unregistered`);
  }

  /**
   * Get all active gateway nodes
   */
  async getActiveNodes(): Promise<string[]> {
    return this.redisService.smembers(REDIS_KEYS.GATEWAY_NODES);
  }

  /**
   * Get node info
   */
  async getNodeInfo(nodeId: string): Promise<GatewayNodeInfo | null> {
    const key = REDIS_KEYS.GATEWAY_NODE(nodeId);
    const data = await this.redisService.hgetall(key);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return {
      nodeId: data.nodeId,
      address: data.address,
      startTime: parseInt(data.startTime, 10),
      lastHeartbeat: parseInt(data.lastHeartbeat, 10),
      connectionCount: parseInt(data.connectionCount, 10),
    };
  }

  // ============ Routing Queries ============

  /**
   * Get gateway for a single user
   */
  async getUserGateway(userId: string): Promise<string | null> {
    return this.redisService.hget(REDIS_KEYS.USER_ROUTE(userId), 'gatewayId');
  }

  /**
   * Get gateways for multiple users (batch query)
   */
  async getUsersGateways(userIds: string[]): Promise<Map<string, string>> {
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
   * Group users by their gateway
   */
  async groupUsersByGateway(userIds: string[]): Promise<Map<string, string[]>> {
    const userGateways = await this.getUsersGateways(userIds);
    const gatewayUsers = new Map<string, string[]>();

    for (const [userId, gatewayId] of userGateways) {
      const users = gatewayUsers.get(gatewayId) || [];
      users.push(userId);
      gatewayUsers.set(gatewayId, users);
    }

    return gatewayUsers;
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

  /**
   * Get online users from a list
   */
  async getOnlineUsers(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) {
      return [];
    }

    const client = this.redisService.getClient();
    const pipeline = client.pipeline();

    for (const userId of userIds) {
      pipeline.exists(REDIS_KEYS.USER_ROUTE(userId));
    }

    const results = await pipeline.exec();
    const onlineUsers: string[] = [];

    results?.forEach((result, index) => {
      const [err, exists] = result;
      if (!err && exists === 1) {
        onlineUsers.push(userIds[index]);
      }
    });

    return onlineUsers;
  }

  // ============ Zombie Session Detection ============

  /**
   * Get zombie sessions (sessions that haven't sent heartbeat)
   */
  async getZombieSessions(
    timeoutMs: number,
  ): Promise<Array<{ userId: string; socketId: string }>> {
    const cutoffTime = Date.now() - timeoutMs;
    const client = this.redisService.getClient();

    // Get sessions with heartbeat older than cutoff
    const zombies = await client.zrangebyscore(
      REDIS_KEYS.HEARTBEAT_CHECK,
      0,
      cutoffTime,
      'LIMIT',
      0,
      100, // Process max 100 at a time
    );

    return zombies.map((z) => {
      const [userId, socketId] = z.split(':');
      return { userId, socketId };
    });
  }

  /**
   * Remove from heartbeat check (after cleanup)
   */
  async removeFromHeartbeatCheck(
    userId: string,
    socketId: string,
  ): Promise<void> {
    await this.redisService
      .getClient()
      .zrem(REDIS_KEYS.HEARTBEAT_CHECK, `${userId}:${socketId}`);
  }
}
