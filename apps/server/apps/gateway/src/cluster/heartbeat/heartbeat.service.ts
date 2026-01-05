import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { SessionService } from '../session/session.service.js';
import { PingMessage, PongMessage } from '@team9/shared';

/**
 * Heartbeat Service - handles ping/pong for connection keep-alive
 */
@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);

  constructor(private readonly sessionService: SessionService) {}

  /**
   * Handle ping from client
   */
  async handlePing(
    client: Socket,
    userId: string,
    data: PingMessage,
  ): Promise<PongMessage> {
    // Update heartbeat in Redis
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

    return {
      type: 'pong',
      timestamp: data.timestamp,
      serverTime: Date.now(),
    };
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
