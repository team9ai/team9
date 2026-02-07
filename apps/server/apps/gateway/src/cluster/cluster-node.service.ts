import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { RedisService } from '@team9/redis';
import { v7 as uuidv7 } from 'uuid';

export interface GatewayNodeInfo {
  nodeId: string;
  address: string;
  startTime: number;
  lastHeartbeat: number;
  connectionCount: number;
}

const REDIS_KEYS = {
  GATEWAY_NODE: (nodeId: string) => `im:node:${nodeId}`,
  GATEWAY_NODES: 'im:nodes',
  GATEWAY_CONNECTIONS: 'im:node_connections',
};

@Injectable()
export class ClusterNodeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClusterNodeService.name);

  private nodeId: string;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private connectionCount = 0;

  // Node heartbeat interval (seconds)
  private readonly NODE_HEARTBEAT_INTERVAL = 10;

  // Node TTL (seconds) - should be > heartbeat interval
  private readonly NODE_TTL = 30;

  constructor(private readonly redisService: RedisService) {
    // Generate unique node ID using hostname + uuid
    const hostname = process.env.HOSTNAME || 'local';
    this.nodeId = `gateway-${hostname}-${uuidv7()}`;
  }

  async onModuleInit(): Promise<void> {
    await this.registerNode();
    this.startHeartbeat();
    this.logger.log(`Gateway node initialized: ${this.nodeId}`);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopHeartbeat();
    await this.unregisterNode();
    this.logger.log(`Gateway node destroyed: ${this.nodeId}`);
  }

  /**
   * Get the current node ID
   */
  getNodeId(): string {
    return this.nodeId;
  }

  /**
   * Update connection count
   */
  updateConnectionCount(count: number): void {
    this.connectionCount = count;
  }

  /**
   * Increment connection count
   */
  incrementConnections(): void {
    this.connectionCount++;
  }

  /**
   * Decrement connection count
   */
  decrementConnections(): void {
    if (this.connectionCount > 0) {
      this.connectionCount--;
    }
  }

  /**
   * Get current connection count
   */
  getConnectionCount(): number {
    return this.connectionCount;
  }

  /**
   * Register this node in Redis
   */
  private async registerNode(): Promise<void> {
    const nodeInfo: GatewayNodeInfo = {
      nodeId: this.nodeId,
      address: this.getNodeAddress(),
      startTime: Date.now(),
      lastHeartbeat: Date.now(),
      connectionCount: this.connectionCount,
    };

    const key = REDIS_KEYS.GATEWAY_NODE(this.nodeId);
    const client = this.redisService.getClient();

    const pipeline = client.pipeline();

    // Store node info as hash
    pipeline.hset(key, {
      nodeId: nodeInfo.nodeId,
      address: nodeInfo.address,
      startTime: nodeInfo.startTime.toString(),
      lastHeartbeat: nodeInfo.lastHeartbeat.toString(),
      connectionCount: nodeInfo.connectionCount.toString(),
    });

    // Set TTL
    pipeline.expire(key, this.NODE_TTL);

    // Add to active nodes set
    pipeline.sadd(REDIS_KEYS.GATEWAY_NODES, this.nodeId);

    // Update connection count sorted set
    pipeline.zadd(
      REDIS_KEYS.GATEWAY_CONNECTIONS,
      this.connectionCount,
      this.nodeId,
    );

    await pipeline.exec();

    this.logger.log(`Node registered in Redis: ${this.nodeId}`);
  }

  /**
   * Unregister this node from Redis
   */
  private async unregisterNode(): Promise<void> {
    const client = this.redisService.getClient();

    const pipeline = client.pipeline();
    pipeline.del(REDIS_KEYS.GATEWAY_NODE(this.nodeId));
    pipeline.srem(REDIS_KEYS.GATEWAY_NODES, this.nodeId);
    pipeline.zrem(REDIS_KEYS.GATEWAY_CONNECTIONS, this.nodeId);

    await pipeline.exec();

    this.logger.log(`Node unregistered from Redis: ${this.nodeId}`);
  }

  /**
   * Start heartbeat timer
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(
      () => this.sendHeartbeat(),
      this.NODE_HEARTBEAT_INTERVAL * 1000,
    );
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Send heartbeat to Redis
   */
  private async sendHeartbeat(): Promise<void> {
    try {
      const key = REDIS_KEYS.GATEWAY_NODE(this.nodeId);
      const now = Date.now();
      const client = this.redisService.getClient();

      const pipeline = client.pipeline();

      // Update heartbeat time and connection count
      pipeline.hset(key, {
        lastHeartbeat: now.toString(),
        connectionCount: this.connectionCount.toString(),
      });

      // Renew TTL
      pipeline.expire(key, this.NODE_TTL);

      // Update connection count in sorted set
      pipeline.zadd(
        REDIS_KEYS.GATEWAY_CONNECTIONS,
        this.connectionCount,
        this.nodeId,
      );

      await pipeline.exec();

      this.logger.debug(
        `Heartbeat sent: ${this.nodeId}, connections: ${this.connectionCount}`,
      );
    } catch (error) {
      this.logger.error(`Failed to send heartbeat: ${error}`);
    }
  }

  /**
   * Get all active gateway nodes
   */
  async getActiveNodes(): Promise<string[]> {
    return this.redisService.smembers(REDIS_KEYS.GATEWAY_NODES);
  }

  /**
   * Get node info by ID
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

  /**
   * Get node with least connections (for load balancing)
   */
  async getLeastLoadedNode(): Promise<string | null> {
    const client = this.redisService.getClient();

    // Get node with lowest connection count
    const result = await client.zrange(REDIS_KEYS.GATEWAY_CONNECTIONS, 0, 0);

    return result.length > 0 ? result[0] : null;
  }

  /**
   * Get node address (for potential inter-node communication)
   */
  private getNodeAddress(): string {
    const host = process.env.POD_IP || process.env.HOST || 'localhost';
    const port = process.env.PORT || '3000';
    return `${host}:${port}`;
  }
}
