import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { SessionService } from '../session/session.service.js';
import { RedisService } from '@team9/redis';
import { PingMessage, PongMessage } from '@team9/shared';
import { REDIS_KEYS } from '../../im/shared/constants/redis-keys.js';

// TTL for legacy socket keys (5 minutes)
const SOCKET_TTL = 300;

/**
 * Heartbeat Service - handles ping/pong for connection keep-alive
 */
@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);

  constructor(
    private readonly sessionService: SessionService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Handle ping from client
   */
  async handlePing(
    client: Socket,
    userId: string,
    data: PingMessage,
  ): Promise<PongMessage> {
    // Update heartbeat in Redis (new session service)
    const success = await this.sessionService.updateHeartbeat(
      userId,
      client.id,
    );

    if (!success) {
      this.logger.warn(
        `Heartbeat update failed for user ${userId}, session mismatch`,
      );
      // Session might have been replaced by new connection
      client.emit('session_expired', { reason: 'session_mismatch' });
    }

    // Renew TTL for legacy socket keys to prevent stale data
    await this.renewLegacySocketTTL(userId, client.id);

    return {
      type: 'pong',
      timestamp: data.timestamp,
      serverTime: Date.now(),
    };
  }

  /**
   * Renew TTL for legacy socket tracking keys
   */
  private async renewLegacySocketTTL(
    userId: string,
    socketId: string,
  ): Promise<void> {
    try {
      await this.redisService.expire(
        REDIS_KEYS.SOCKET_USER(socketId),
        SOCKET_TTL,
      );
      await this.redisService.expire(
        REDIS_KEYS.USER_SOCKETS(userId),
        SOCKET_TTL,
      );
    } catch (error) {
      this.logger.debug(`Failed to renew legacy socket TTL: ${error}`);
    }
  }

  /**
   * Update heartbeat on any activity (not just ping)
   */
  async updateOnActivity(userId: string, socketId: string): Promise<void> {
    try {
      await this.sessionService.updateHeartbeat(userId, socketId);
    } catch (error) {
      this.logger.error(`Failed to update heartbeat: ${error}`);
    }
  }
}
