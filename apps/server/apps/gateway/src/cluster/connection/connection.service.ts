import {
  Injectable,
  Logger,
  OnModuleInit,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Server } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { RedisService } from '@team9/redis';
import { WS_EVENTS } from '../../im/websocket/events/events.constants.js';
import { MessagesService } from '../../im/messages/messages.service.js';

// Local interface for OnEvent decorator compatibility
interface DownstreamMessagePayload {
  msgId: string;
  seqId?: bigint | string;
  senderId: string;
  targetType: 'user' | 'channel';
  targetId: string;
  targetUserIds: string[];
  type: string;
  payload: unknown;
  timestamp: number;
}

/**
 * Connection Service - manages WebSocket connections and message delivery
 *
 * Responsibilities:
 * - Track local connections (socketId -> userId)
 * - Handle downstream message delivery
 * - Manage connection lifecycle
 */
@Injectable()
export class ConnectionService implements OnModuleInit {
  private readonly logger = new Logger(ConnectionService.name);

  // Local connection map: socketId -> userId
  private localConnections = new Map<string, string>();

  // Reverse map: userId -> Set<socketId>
  private userSockets = new Map<string, Set<string>>();

  // Socket.io server reference
  private server: Server | null = null;

  constructor(
    private readonly redisService: RedisService,
    @Inject(forwardRef(() => MessagesService))
    private readonly messagesService: MessagesService,
  ) {}

  onModuleInit(): void {
    this.logger.log('Connection service initialized');
  }

  /**
   * Set the Socket.io server reference
   */
  setServer(server: Server): void {
    this.server = server;
    this.logger.log('Socket.io server reference set');
  }

  /**
   * Register a new connection
   */
  registerConnection(socketId: string, userId: string): void {
    this.localConnections.set(socketId, userId);

    const userSocketSet = this.userSockets.get(userId) || new Set();
    userSocketSet.add(socketId);
    this.userSockets.set(userId, userSocketSet);

    this.logger.debug(
      `Connection registered: socket=${socketId}, user=${userId}`,
    );
  }

  /**
   * Unregister a connection
   */
  unregisterConnection(socketId: string): string | undefined {
    const userId = this.localConnections.get(socketId);

    if (userId) {
      this.localConnections.delete(socketId);

      const userSocketSet = this.userSockets.get(userId);
      if (userSocketSet) {
        userSocketSet.delete(socketId);
        if (userSocketSet.size === 0) {
          this.userSockets.delete(userId);
        }
      }

      this.logger.debug(
        `Connection unregistered: socket=${socketId}, user=${userId}`,
      );
    }

    return userId;
  }

  /**
   * Get user ID by socket ID
   */
  getUserBySocket(socketId: string): string | undefined {
    return this.localConnections.get(socketId);
  }

  /**
   * Get socket IDs for a user (local only)
   */
  getLocalUserSockets(userId: string): string[] {
    const sockets = this.userSockets.get(userId);
    return sockets ? Array.from(sockets) : [];
  }

  /**
   * Check if user has local connections
   */
  hasLocalConnection(userId: string): boolean {
    return this.userSockets.has(userId);
  }

  /**
   * Get local connection count
   */
  getConnectionCount(): number {
    return this.localConnections.size;
  }

  /**
   * Handle downstream message from RabbitMQ
   * Fetches full message details to ensure consistent MessageResponse format
   */
  @OnEvent('im.downstream.message')
  async handleDownstreamMessage(
    message: DownstreamMessagePayload,
  ): Promise<void> {
    if (!this.server) {
      this.logger.warn('Server not set, cannot deliver message');
      return;
    }

    // Fetch full message details to ensure consistent format with HTTP path
    let fullMessage: unknown;
    try {
      fullMessage = await this.messagesService.getMessageWithDetails(
        message.msgId,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to fetch message details for ${message.msgId}, using envelope format: ${error}`,
      );
      // Fallback to envelope format if fetch fails
      fullMessage = {
        msgId: message.msgId,
        seqId: message.seqId?.toString(),
        senderId: message.senderId,
        targetType: message.targetType,
        targetId: message.targetId,
        type: message.type,
        payload: message.payload,
        timestamp: message.timestamp,
      };
    }

    for (const userId of message.targetUserIds) {
      const socketIds = this.getLocalUserSockets(userId);

      if (socketIds.length === 0) {
        this.logger.debug(
          `No local sockets for user ${userId}, message may be offline`,
        );
        continue;
      }

      for (const socketId of socketIds) {
        try {
          this.server.to(socketId).emit(WS_EVENTS.MESSAGE.NEW, fullMessage);

          this.logger.debug(
            `Delivered message ${message.msgId} to socket ${socketId}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to deliver message to socket ${socketId}: ${error}`,
          );
        }
      }
    }
  }

  /**
   * Send message to a specific socket
   */
  sendToSocket(socketId: string, event: string, data: unknown): boolean {
    if (!this.server) {
      return false;
    }

    const socket = this.server.sockets.sockets.get(socketId);
    if (!socket) {
      return false;
    }

    socket.emit(event, data);
    return true;
  }

  /**
   * Send message to all sockets of a user (local only)
   */
  sendToUser(userId: string, event: string, data: unknown): number {
    const socketIds = this.getLocalUserSockets(userId);
    let sent = 0;

    for (const socketId of socketIds) {
      if (this.sendToSocket(socketId, event, data)) {
        sent++;
      }
    }

    return sent;
  }

  /**
   * Broadcast to a room
   */
  broadcastToRoom(room: string, event: string, data: unknown): void {
    if (!this.server) {
      return;
    }

    this.server.to(room).emit(event, data);
  }
}
