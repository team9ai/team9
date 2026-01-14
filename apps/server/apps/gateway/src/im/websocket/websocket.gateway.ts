import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AuthService } from '../../auth/auth.service.js';
import { UsersService } from '../users/users.service.js';
import { ChannelsService } from '../channels/channels.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { RedisService } from '@team9/redis';
import { env, PingMessage, PongMessage } from '@team9/shared';
import { WS_EVENTS } from './events/events.constants.js';
import { REDIS_KEYS } from '../shared/constants/redis-keys.js';
import { SocketWithUser } from '../shared/interfaces/socket-with-user.interface.js';
import { WorkspaceService } from '../../workspace/workspace.service.js';
import { RabbitMQEventService, GatewayMQService } from '@team9/rabbitmq';
import { ClusterNodeService } from '../../cluster/cluster-node.service.js';
import { SessionService } from '../../cluster/session/session.service.js';
import { HeartbeatService } from '../../cluster/heartbeat/heartbeat.service.js';
import { ZombieCleanerService } from '../../cluster/heartbeat/zombie-cleaner.service.js';
import { ConnectionService } from '../../cluster/connection/connection.service.js';
import { SocketRedisAdapterService } from '../../cluster/adapter/socket-redis-adapter.service.js';
interface ChannelData {
  channelId: string;
}

interface MarkAsReadData {
  channelId: string;
  messageId: string;
}

interface ReactionData {
  messageId: string;
  emoji: string;
}

interface PingData {
  timestamp: number;
}

interface MessageAckData {
  msgId: string;
  ackType: 'delivered' | 'read';
}

@WebSocketGateway({
  cors: {
    origin: env.CORS_ORIGIN,
    credentials: true,
  },
  namespace: '/im',
})
export class WebsocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  private readonly logger = new Logger(WebsocketGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly channelsService: ChannelsService,
    private readonly messagesService: MessagesService,
    private readonly redisService: RedisService,
    @Inject(forwardRef(() => WorkspaceService))
    private readonly workspaceService: WorkspaceService,
    @Optional() private readonly rabbitMQEventService?: RabbitMQEventService,
    // Distributed IM Architecture services
    @Optional() private readonly clusterNodeService?: ClusterNodeService,
    @Optional() private readonly sessionService?: SessionService,
    @Optional() private readonly heartbeatService?: HeartbeatService,
    @Optional() private readonly zombieCleanerService?: ZombieCleanerService,
    @Optional() private readonly connectionService?: ConnectionService,
    @Optional() private readonly gatewayMQService?: GatewayMQService,
    @Optional()
    private readonly socketRedisAdapterService?: SocketRedisAdapterService,
  ) {}

  /**
   * Called after the WebSocket server is initialized
   */
  afterInit(server: Server): void {
    this.logger.log('WebSocket Gateway initialized');

    // Configure Socket.io Redis Adapter for multi-node deployment
    if (this.socketRedisAdapterService?.isInitialized()) {
      try {
        server.adapter(this.socketRedisAdapterService.getAdapter());
        this.logger.log(
          'Socket.io Redis Adapter configured for cross-node broadcasting',
        );
      } catch (error) {
        this.logger.error('Failed to configure Socket.io Redis Adapter', error);
      }
    }

    // Set server reference for distributed services
    if (this.zombieCleanerService) {
      this.zombieCleanerService.setServer(server);
    }
    if (this.connectionService) {
      this.connectionService.setServer(server);
    }

    // Initialize Gateway MQ with node ID
    if (this.gatewayMQService && this.clusterNodeService) {
      const nodeId = this.clusterNodeService.getNodeId();
      this.gatewayMQService.initializeForNode(nodeId).catch((err) => {
        this.logger.error(`Failed to initialize Gateway MQ: ${err}`);
      });
    }
  }

  // ==================== Connection Lifecycle ====================

  async handleConnection(client: Socket) {
    this.logger.log(`[WS] Client attempting connection: ${client.id}`);
    this.logger.debug(
      `[WS] Handshake auth: ${JSON.stringify(client.handshake.auth)}`,
    );
    this.logger.debug(
      `[WS] Headers: ${JSON.stringify(client.handshake.headers)}`,
    );

    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn(`[WS] No token provided for client ${client.id}`);
        client.emit(WS_EVENTS.AUTH_ERROR, { message: 'No token provided' });
        client.disconnect();
        return;
      }

      this.logger.debug(`[WS] Token received, verifying...`);
      const payload = this.authService.verifyToken(token);
      this.logger.log(
        `[WS] Token verified for user: ${payload.sub} (${payload.username})`,
      );

      (client as SocketWithUser).userId = payload.sub;
      (client as SocketWithUser).username = payload.username;

      // Store socket mapping (legacy)
      this.logger.debug(`[WS] Storing socket mapping in Redis...`);
      await this.redisService.set(
        REDIS_KEYS.SOCKET_USER(client.id),
        payload.sub,
      );
      await this.redisService.sadd(
        REDIS_KEYS.USER_SOCKETS(payload.sub),
        client.id,
      );

      // Register with distributed services (new architecture - multi-device support)
      if (this.sessionService && this.clusterNodeService) {
        const nodeId = this.clusterNodeService.getNodeId();
        // Use addDeviceSession for multi-device support
        await this.sessionService.addDeviceSession(payload.sub, {
          socketId: client.id,
          gatewayId: nodeId,
          loginTime: Date.now(),
          lastActiveTime: Date.now(),
          deviceInfo: {
            platform: client.handshake.auth?.platform || 'unknown',
            version: client.handshake.auth?.version || 'unknown',
            deviceId: client.handshake.auth?.deviceId,
          },
        });
        this.clusterNodeService.incrementConnections();
      }

      // Register with connection service
      if (this.connectionService) {
        this.connectionService.registerConnection(client.id, payload.sub);
      }

      // Set user online
      this.logger.log(`[WS] Setting user ${payload.sub} online in Redis...`);
      try {
        await this.usersService.setOnline(payload.sub);
        this.logger.log(`[WS] ✅ User ${payload.sub} is now online`);
      } catch (error) {
        this.logger.error(`[WS] ❌ Failed to set user online:`, error);
        throw error; // Re-throw to be caught by outer catch
      }

      // Auto-join user's channels
      this.logger.debug(`[WS] Loading user channels...`);
      const userChannels = await this.channelsService.getUserChannels(
        payload.sub,
      );
      this.logger.debug(`[WS] Found ${userChannels.length} channels`);
      for (const channel of userChannels) {
        void client.join(`channel:${channel.id}`);
      }

      // Auto-join user's workspaces
      const workspaceIds = await this.workspaceService.getWorkspaceIdsByUserId(
        payload.sub,
      );
      for (const workspaceId of workspaceIds) {
        void client.join(`workspace:${workspaceId}`);
      }

      // Broadcast user online to each workspace
      for (const workspaceId of workspaceIds) {
        this.server.to(`workspace:${workspaceId}`).emit(WS_EVENTS.USER_ONLINE, {
          userId: payload.sub,
          username: payload.username,
          workspaceId,
        });
      }

      // Notify IM Worker service that user is online (for offline message delivery)
      if (this.gatewayMQService && this.clusterNodeService) {
        try {
          await this.gatewayMQService.publishUpstream({
            gatewayId: this.clusterNodeService.getNodeId(),
            userId: payload.sub,
            socketId: client.id,
            message: {
              msgId: uuidv7(),
              senderId: payload.sub,
              type: 'presence',
              targetType: 'user',
              targetId: payload.sub,
              payload: { event: 'online' },
              timestamp: Date.now(),
            },
            receivedAt: Date.now(),
          });
          this.logger.debug(
            `[WS] Notified IM Worker service of user ${payload.sub} online`,
          );
        } catch (error) {
          this.logger.warn(
            `[WS] Failed to notify IM Worker service of user online: ${error}`,
          );
        }
      }

      // Pull and deliver offline messages from RabbitMQ (if enabled)
      if (this.rabbitMQEventService) {
        try {
          const offlineMessages =
            await this.rabbitMQEventService.getOfflineMessages(
              payload.sub,
              100, // Max 100 offline messages
            );

          if (offlineMessages.length > 0) {
            this.logger.log(
              `Delivering ${offlineMessages.length} offline messages to user ${payload.sub}`,
            );

            // Send offline messages to client in order
            for (const msg of offlineMessages) {
              client.emit(msg.eventType, msg.payload);
            }
          }
        } catch (error) {
          this.logger.warn(
            `Failed to retrieve offline messages for user ${payload.sub}: ${error.message}`,
          );
          // Don't fail connection if offline message retrieval fails
        }
      }

      client.emit(WS_EVENTS.AUTHENTICATED, { userId: payload.sub });
      this.logger.log(
        `Client authenticated: ${client.id} (user: ${payload.sub})`,
      );
    } catch (error) {
      this.logger.error(`Authentication failed for ${client.id}:`, error);
      client.emit(WS_EVENTS.AUTH_ERROR, { message: 'Authentication failed' });
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const socketClient = client as SocketWithUser;

    if (socketClient.userId) {
      // Remove socket mapping (legacy)
      await this.redisService.del(REDIS_KEYS.SOCKET_USER(client.id));
      await this.redisService.srem(
        REDIS_KEYS.USER_SOCKETS(socketClient.userId),
        client.id,
      );

      // Cleanup distributed services (new architecture - multi-device support)
      if (this.sessionService) {
        // Use removeDeviceSession for multi-device support
        await this.sessionService.removeDeviceSession(
          socketClient.userId,
          client.id,
        );
      }
      if (this.connectionService) {
        this.connectionService.unregisterConnection(client.id);
      }
      if (this.clusterNodeService) {
        this.clusterNodeService.decrementConnections();
      }

      // Check if user has other active device sessions (new architecture)
      let hasActiveSessions = false;
      if (this.sessionService) {
        hasActiveSessions = await this.sessionService.hasActiveDeviceSessions(
          socketClient.userId,
        );
      } else {
        // Fallback to legacy check
        const remainingSockets = await this.redisService.smembers(
          REDIS_KEYS.USER_SOCKETS(socketClient.userId),
        );
        hasActiveSessions = remainingSockets.length > 0;
      }

      if (!hasActiveSessions) {
        // User has no more connections on any device, set offline
        await this.usersService.setOffline(socketClient.userId);

        // Get user's workspaces
        const workspaceIds =
          await this.workspaceService.getWorkspaceIdsByUserId(
            socketClient.userId,
          );

        // Broadcast offline to each workspace
        for (const workspaceId of workspaceIds) {
          this.server
            .to(`workspace:${workspaceId}`)
            .emit(WS_EVENTS.USER_OFFLINE, {
              userId: socketClient.userId,
              workspaceId,
            });
        }

        // Notify IM Worker service that user is offline
        if (this.gatewayMQService && this.clusterNodeService) {
          try {
            await this.gatewayMQService.publishUpstream({
              gatewayId: this.clusterNodeService.getNodeId(),
              userId: socketClient.userId,
              socketId: client.id,
              message: {
                msgId: uuidv7(),
                senderId: socketClient.userId,
                type: 'presence',
                targetType: 'user',
                targetId: socketClient.userId,
                payload: { event: 'offline' },
                timestamp: Date.now(),
              },
              receivedAt: Date.now(),
            });
            this.logger.debug(
              `[WS] Notified IM Worker service of user ${socketClient.userId} offline`,
            );
          } catch (error) {
            this.logger.warn(
              `[WS] Failed to notify IM Worker service of user offline: ${error}`,
            );
          }
        }
      }
    }

    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // ==================== Channel Operations ====================

  @SubscribeMessage(WS_EVENTS.JOIN_CHANNEL)
  async handleJoinChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ChannelData,
  ) {
    const socketClient = client as SocketWithUser;
    const { channelId } = data;

    const isMember = await this.channelsService.isMember(
      channelId,
      socketClient.userId,
    );
    if (!isMember) {
      return { error: 'Not a member of this channel' };
    }

    void client.join(`channel:${channelId}`);

    client.to(`channel:${channelId}`).emit(WS_EVENTS.CHANNEL_JOINED, {
      channelId,
      userId: socketClient.userId,
      username: socketClient.username,
    });

    return { success: true };
  }

  @SubscribeMessage(WS_EVENTS.LEAVE_CHANNEL)
  handleLeaveChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ChannelData,
  ) {
    const socketClient = client as SocketWithUser;
    const { channelId } = data;

    void client.leave(`channel:${channelId}`);

    client.to(`channel:${channelId}`).emit(WS_EVENTS.CHANNEL_LEFT, {
      channelId,
      userId: socketClient.userId,
    });

    return { success: true };
  }

  // ==================== Read Status ====================

  @SubscribeMessage(WS_EVENTS.MARK_AS_READ)
  async handleMarkAsRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: MarkAsReadData,
  ) {
    const socketClient = client as SocketWithUser;
    const { channelId, messageId } = data;

    await this.messagesService.markAsRead(
      channelId,
      socketClient.userId,
      messageId,
    );

    client.to(`channel:${channelId}`).emit(WS_EVENTS.READ_STATUS_UPDATED, {
      channelId,
      userId: socketClient.userId,
      lastReadMessageId: messageId,
    });

    return { success: true };
  }

  // ==================== Typing Status ====================

  @SubscribeMessage(WS_EVENTS.TYPING_START)
  async handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ChannelData,
  ) {
    const socketClient = client as SocketWithUser;
    const { channelId } = data;
    const typingKey = `im:typing:${channelId}:${socketClient.userId}`;

    // Set typing status with 5s TTL
    await this.redisService.set(typingKey, '1', 5);

    client.to(`channel:${channelId}`).emit(WS_EVENTS.USER_TYPING, {
      channelId,
      userId: socketClient.userId,
      username: socketClient.username,
      isTyping: true,
    });

    return { success: true };
  }

  @SubscribeMessage(WS_EVENTS.TYPING_STOP)
  async handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ChannelData,
  ) {
    const socketClient = client as SocketWithUser;
    const { channelId } = data;
    const typingKey = `im:typing:${channelId}:${socketClient.userId}`;

    await this.redisService.del(typingKey);

    client.to(`channel:${channelId}`).emit(WS_EVENTS.USER_TYPING, {
      channelId,
      userId: socketClient.userId,
      isTyping: false,
    });

    return { success: true };
  }

  // ==================== Heartbeat (Ping/Pong) ====================

  @SubscribeMessage(WS_EVENTS.PING)
  async handlePing(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: PingData,
  ): Promise<PongMessage> {
    const socketClient = client as SocketWithUser;
    const pingMessage: PingMessage = {
      type: 'ping',
      timestamp: data.timestamp,
    };

    if (!socketClient.userId) {
      return {
        type: 'pong',
        timestamp: data.timestamp,
        serverTime: Date.now(),
      };
    }

    // Use heartbeat service if available
    if (this.heartbeatService) {
      return this.heartbeatService.handlePing(
        client,
        socketClient.userId,
        pingMessage,
      );
    }

    // Fallback: simple pong response
    return {
      type: 'pong',
      timestamp: data.timestamp,
      serverTime: Date.now(),
    };
  }

  // ==================== Reactions ====================

  @SubscribeMessage(WS_EVENTS.ADD_REACTION)
  async handleAddReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ReactionData,
  ) {
    const socketClient = client as SocketWithUser;
    const { messageId, emoji } = data;

    await this.messagesService.addReaction(
      messageId,
      socketClient.userId,
      emoji,
    );

    const channelId = await this.messagesService.getMessageChannelId(messageId);

    this.server.to(`channel:${channelId}`).emit(WS_EVENTS.REACTION_ADDED, {
      messageId,
      userId: socketClient.userId,
      emoji,
    });

    return { success: true };
  }

  @SubscribeMessage(WS_EVENTS.REMOVE_REACTION)
  async handleRemoveReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ReactionData,
  ) {
    const socketClient = client as SocketWithUser;
    const { messageId, emoji } = data;

    await this.messagesService.removeReaction(
      messageId,
      socketClient.userId,
      emoji,
    );

    const channelId = await this.messagesService.getMessageChannelId(messageId);

    this.server.to(`channel:${channelId}`).emit(WS_EVENTS.REACTION_REMOVED, {
      messageId,
      userId: socketClient.userId,
      emoji,
    });

    return { success: true };
  }

  // ==================== Message ACK (via RabbitMQ to Logic Service) ====================

  @SubscribeMessage(WS_EVENTS.MESSAGE_ACK)
  async handleMessageAck(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: MessageAckData,
  ) {
    const socketClient = client as SocketWithUser;
    const { msgId, ackType } = data;

    if (!socketClient.userId) {
      return { error: 'Not authenticated' };
    }

    // Send ACK to IM Worker service via RabbitMQ for reliable processing
    if (this.gatewayMQService && this.clusterNodeService) {
      try {
        await this.gatewayMQService.publishUpstream({
          gatewayId: this.clusterNodeService.getNodeId(),
          userId: socketClient.userId,
          socketId: client.id,
          message: {
            msgId,
            senderId: socketClient.userId,
            type: 'ack',
            targetType: 'user',
            targetId: socketClient.userId,
            payload: { msgId, ackType },
            timestamp: Date.now(),
          },
          receivedAt: Date.now(),
        });

        client.emit(WS_EVENTS.MESSAGE_ACK_RESPONSE, {
          msgId,
          status: 'received',
        });

        return { success: true };
      } catch (error) {
        this.logger.error(`Failed to send ACK to IM Worker service: ${error}`);
        return { error: 'Failed to process ACK' };
      }
    }

    // Fallback: just acknowledge receipt
    client.emit(WS_EVENTS.MESSAGE_ACK_RESPONSE, { msgId, status: 'received' });
    return { success: true };
  }

  // ==================== Helper Methods ====================

  async sendToUser(
    userId: string,
    event: string,
    data: unknown,
  ): Promise<void> {
    const socketIds = await this.redisService.smembers(
      REDIS_KEYS.USER_SOCKETS(userId),
    );
    for (const socketId of socketIds) {
      this.server.to(socketId).emit(event, data);
    }
  }

  sendToChannel(channelId: string, event: string, data: unknown): void {
    this.server.to(`channel:${channelId}`).emit(event, data);
  }

  async broadcastMessageUpdate(
    channelId: string,
    messageId: string,
  ): Promise<void> {
    const message = await this.messagesService.getMessageWithDetails(messageId);
    this.sendToChannel(channelId, WS_EVENTS.MESSAGE_UPDATED, message);
  }

  broadcastMessageDeleted(channelId: string, messageId: string): void {
    this.sendToChannel(channelId, WS_EVENTS.MESSAGE_DELETED, { messageId });
  }

  // ==================== Workspace Operations ====================

  async broadcastToWorkspace(
    workspaceId: string,
    event: string,
    data: unknown,
  ): Promise<void> {
    this.server.to(`workspace:${workspaceId}`).emit(event, data);
  }

  @SubscribeMessage(WS_EVENTS.JOIN_WORKSPACE)
  async handleJoinWorkspace(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { workspaceId: string },
  ) {
    const socketClient = client as SocketWithUser;
    const { workspaceId } = data;

    // Verify user is a member
    const isMember = await this.workspaceService.isWorkspaceMember(
      workspaceId,
      socketClient.userId,
    );
    if (!isMember) {
      return { error: 'Not a member of this workspace' };
    }

    // Join workspace room
    void client.join(`workspace:${workspaceId}`);

    // Get all workspace members
    const members = await this.workspaceService.getWorkspaceMembers(
      workspaceId,
      socketClient.userId,
    );

    // Send initial members list to the client
    client.emit(WS_EVENTS.WORKSPACE_MEMBERS_LIST, {
      workspaceId,
      members,
    });

    return { success: true };
  }
}
