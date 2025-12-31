import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Server } from 'socket.io';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SessionService } from '../session/session.service.js';
import { GatewayNodeService } from '../gateway-node.service.js';
import { HEARTBEAT_CONFIG } from './heartbeat.constants.js';

/**
 * Zombie Cleaner Service - detects and cleans up dead connections
 *
 * Responsibilities:
 * - Periodically scan for sessions without recent heartbeat
 * - Disconnect zombie sockets
 * - Clean up Redis session data
 * - Notify about user offline events
 */
@Injectable()
export class ZombieCleanerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ZombieCleanerService.name);

  private cleanerInterval: NodeJS.Timeout | null = null;
  private server: Server | null = null;

  constructor(
    private readonly sessionService: SessionService,
    private readonly nodeService: GatewayNodeService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit(): void {
    // Start periodic cleanup
    this.cleanerInterval = setInterval(
      () => this.cleanZombies(),
      HEARTBEAT_CONFIG.ZOMBIE_CHECK_INTERVAL * 1000,
    );

    this.logger.log(
      `Zombie cleaner started (interval: ${HEARTBEAT_CONFIG.ZOMBIE_CHECK_INTERVAL}s)`,
    );
  }

  onModuleDestroy(): void {
    if (this.cleanerInterval) {
      clearInterval(this.cleanerInterval);
      this.cleanerInterval = null;
    }
    this.logger.log('Zombie cleaner stopped');
  }

  /**
   * Set the Socket.io server instance
   * This should be called from WebSocket gateway after initialization
   */
  setServer(server: Server): void {
    this.server = server;
    this.logger.log('Socket.io server reference set');
  }

  /**
   * Main cleanup routine
   */
  private async cleanZombies(): Promise<void> {
    if (!this.server) {
      this.logger.debug('Server not set, skipping zombie cleanup');
      return;
    }

    try {
      const timeoutMs = HEARTBEAT_CONFIG.TIMEOUT * 1000;
      const zombies = await this.sessionService.getZombieSessions(timeoutMs);

      if (zombies.length === 0) {
        return;
      }

      this.logger.log(`Found ${zombies.length} zombie sessions to clean`);

      for (const { userId, socketId } of zombies) {
        await this.cleanupZombieSession(userId, socketId);
      }

      this.logger.log(`Cleaned ${zombies.length} zombie sessions`);
    } catch (error) {
      this.logger.error(`Zombie cleaning failed: ${error}`);
    }
  }

  /**
   * Clean up a single zombie session
   */
  private async cleanupZombieSession(
    userId: string,
    socketId: string,
  ): Promise<void> {
    try {
      // Try to disconnect the socket if it still exists
      const socket = this.server?.sockets?.sockets?.get(socketId);
      if (socket) {
        // Notify client before disconnecting
        socket.emit('session_timeout', {
          reason: 'heartbeat_timeout',
          message: 'Connection timed out due to no heartbeat',
        });

        // Force disconnect
        socket.disconnect(true);

        this.logger.debug(`Disconnected zombie socket: ${socketId}`);
      }

      // Clean up Redis session
      await this.sessionService.removeUserSession(userId, socketId);
      await this.sessionService.removeFromHeartbeatCheck(userId, socketId);

      // Emit event for user offline notification
      this.eventEmitter.emit('im.user.offline', {
        userId,
        socketId,
        reason: 'zombie_cleanup',
        gatewayId: this.nodeService.getNodeId(),
      });

      this.logger.debug(
        `Cleaned zombie session: user=${userId}, socket=${socketId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to clean zombie session ${userId}:${socketId}: ${error}`,
      );
    }
  }

  /**
   * Force cleanup a specific session (called externally)
   */
  async forceCleanup(userId: string, socketId: string): Promise<void> {
    await this.cleanupZombieSession(userId, socketId);
  }
}
