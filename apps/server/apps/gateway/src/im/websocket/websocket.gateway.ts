import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { AuthService } from '../../auth/auth.service.js';
import { UsersService } from '../users/users.service.js';
import { ChannelsService } from '../channels/channels.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { RedisService } from '@team9/redis';
import { env } from '@team9/shared';
import { WS_EVENTS } from './events/events.constants.js';
import { REDIS_KEYS } from '../shared/constants/redis-keys.js';
import { SocketWithUser } from '../shared/interfaces/socket-with-user.interface.js';

interface SendMessageData {
  channelId: string;
  content: string;
  parentId?: string;
}

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

@WebSocketGateway({
  cors: {
    origin: env.CORS_ORIGIN,
    credentials: true,
  },
  namespace: '/im',
})
export class WebsocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect
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
  ) {}

  // ==================== Connection Lifecycle ====================

  async handleConnection(client: Socket) {
    this.logger.log(`Client attempting connection: ${client.id}`);

    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.emit(WS_EVENTS.AUTH_ERROR, { message: 'No token provided' });
        client.disconnect();
        return;
      }

      const payload = this.authService.verifyToken(token);
      (client as SocketWithUser).userId = payload.sub;
      (client as SocketWithUser).username = payload.username;

      // Store socket mapping
      await this.redisService.set(
        REDIS_KEYS.SOCKET_USER(client.id),
        payload.sub,
      );
      await this.redisService.sadd(
        REDIS_KEYS.USER_SOCKETS(payload.sub),
        client.id,
      );

      // Set user online
      await this.usersService.setOnline(payload.sub);

      // Auto-join user's channels
      const userChannels = await this.channelsService.getUserChannels(
        payload.sub,
      );
      for (const channel of userChannels) {
        void client.join(`channel:${channel.id}`);
      }

      // Broadcast user online
      this.server.emit(WS_EVENTS.USER_ONLINE, {
        userId: payload.sub,
        username: payload.username,
      });

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
      // Remove socket mapping
      await this.redisService.del(REDIS_KEYS.SOCKET_USER(client.id));
      await this.redisService.srem(
        REDIS_KEYS.USER_SOCKETS(socketClient.userId),
        client.id,
      );

      // Check if user has other active connections
      const remainingSockets = await this.redisService.smembers(
        REDIS_KEYS.USER_SOCKETS(socketClient.userId),
      );

      if (remainingSockets.length === 0) {
        // User has no more connections, set offline
        await this.usersService.setOffline(socketClient.userId);
        this.server.emit(WS_EVENTS.USER_OFFLINE, {
          userId: socketClient.userId,
        });
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

  // ==================== Message Operations ====================

  @SubscribeMessage(WS_EVENTS.SEND_MESSAGE)
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SendMessageData,
  ) {
    const socketClient = client as SocketWithUser;
    const { channelId, content, parentId } = data;

    const isMember = await this.channelsService.isMember(
      channelId,
      socketClient.userId,
    );
    if (!isMember) {
      return { error: 'Not a member of this channel' };
    }

    try {
      const message = await this.messagesService.create(
        channelId,
        socketClient.userId,
        {
          content,
          parentId,
        },
      );

      // Broadcast to channel
      this.server
        .to(`channel:${channelId}`)
        .emit(WS_EVENTS.NEW_MESSAGE, message);

      // Stop typing indicator
      await this.handleTypingStop(client, { channelId });

      return { success: true, message };
    } catch (error) {
      return { error: (error as Error).message };
    }
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
}
