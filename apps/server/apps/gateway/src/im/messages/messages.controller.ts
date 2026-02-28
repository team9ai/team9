import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ForbiddenException,
  Inject,
  forwardRef,
  Optional,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { v7 as uuidv7 } from 'uuid';
import {
  MessagesService,
  MessageResponse,
  PaginatedMessagesResponse,
  ThreadResponse,
  SubRepliesResponse,
} from './messages.service.js';
import {
  CreateMessageDto,
  UpdateMessageDto,
  AddReactionDto,
} from './dto/index.js';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { GatewayMQService } from '@team9/rabbitmq';
import type { PostBroadcastTask } from '@team9/shared';
import { ChannelsService } from '../channels/channels.service.js';
import { WebsocketGateway } from '../websocket/websocket.gateway.js';
import { WS_EVENTS } from '../websocket/events/events.constants.js';
import { ImWorkerGrpcClientService } from '../services/im-worker-grpc-client.service.js';

@Controller({
  path: 'im',
  version: '1',
})
@UseGuards(AuthGuard)
export class MessagesController {
  private readonly logger = new Logger(MessagesController.name);

  constructor(
    private readonly messagesService: MessagesService,
    private readonly channelsService: ChannelsService,
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway: WebsocketGateway,
    private readonly imWorkerGrpcClientService: ImWorkerGrpcClientService,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly gatewayMQService?: GatewayMQService,
  ) {}

  @Get('channels/:channelId/messages')
  async getChannelMessages(
    @CurrentUser('sub') userId: string,
    @Param('channelId') channelId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('after') after?: string,
    @Query('around') around?: string,
  ): Promise<MessageResponse[] | PaginatedMessagesResponse> {
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      // Allow non-members to read public channel messages (read-only preview)
      const channel = await this.channelsService.findById(channelId);
      if (!channel || channel.type !== 'public') {
        throw new ForbiddenException('Access denied');
      }
    }
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    // When after/around is used, return paginated response with hasOlder/hasNewer
    if (after || around) {
      return this.messagesService.getChannelMessagesPaginated(
        channelId,
        parsedLimit,
        { before, after, around },
      );
    }
    // Legacy: flat array for backward compatibility (OpenClaw plugin etc.)
    return this.messagesService.getChannelMessages(
      channelId,
      parsedLimit,
      before,
    );
  }

  @Post('channels/:channelId/messages')
  async createMessage(
    @CurrentUser('sub') userId: string,
    @Param('channelId') channelId: string,
    @Body() dto: CreateMessageDto,
  ): Promise<MessageResponse> {
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Access denied');
    }

    const clientMsgId = dto.clientMsgId || uuidv7();

    // Get workspaceId (tenantId) from channel for message context
    const channel = await this.channelsService.findById(channelId);
    const workspaceId = channel?.tenantId ?? undefined;

    // Determine message type based on attachments
    const messageType = dto.attachments?.length ? 'file' : 'text';

    // Create message via gRPC
    const result = await this.imWorkerGrpcClientService.createMessage({
      clientMsgId,
      channelId,
      senderId: userId,
      content: dto.content,
      parentId: dto.parentId,
      type: messageType,
      workspaceId,
      attachments: dto.attachments,
      metadata: dto.metadata,
    });

    // Fetch the full message details for response
    const message = await this.messagesService.getMessageWithDetails(
      result.msgId,
    );

    // Immediately broadcast to online users via Socket.io Redis Adapter
    // Skip broadcast when the message is part of a streaming session (bot will
    // emit streaming_end with the persisted message, which handles the broadcast)
    if (!dto.skipBroadcast) {
      this.websocketGateway.sendToChannel(
        channelId,
        WS_EVENTS.MESSAGE.NEW,
        message,
      );
    }

    const broadcastAt = Date.now();

    // Send post-broadcast task to IM Worker Service via RabbitMQ (event-driven)
    // This handles: unread counts, outbox completion
    if (this.gatewayMQService?.isReady()) {
      const postBroadcastTask: PostBroadcastTask = {
        msgId: result.msgId,
        channelId,
        senderId: userId,
        workspaceId,
        broadcastAt,
      };

      // Fire-and-forget: don't block response for post-broadcast processing
      this.gatewayMQService
        .publishPostBroadcast(postBroadcastTask)
        .catch((err) => {
          this.logger.warn(`Failed to publish post-broadcast task: ${err}`);
          // Outbox processor will handle it as fallback
        });
    } else {
      this.logger.warn(
        `[sendMessage] GatewayMQService not ready, skipping post-broadcast task`,
      );
    }

    this.logger.debug(`Message ${result.msgId} persisted and broadcast (gRPC)`);

    // Emit event for search indexing
    this.eventEmitter.emit('message.created', {
      message: {
        id: message.id,
        channelId: message.channelId,
        senderId: message.senderId,
        content: message.content,
        type: message.type,
        isPinned: message.isPinned,
        parentId: message.parentId,
        createdAt: message.createdAt,
      },
      channel: channel,
      sender: message.sender
        ? {
            id: message.sender.id,
            username: message.sender.username,
            displayName: message.sender.displayName,
          }
        : undefined,
    });

    return message;
  }

  @Get('channels/:channelId/pinned')
  async getPinnedMessages(
    @CurrentUser('sub') userId: string,
    @Param('channelId') channelId: string,
  ): Promise<MessageResponse[]> {
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Access denied');
    }
    return this.messagesService.getPinnedMessages(channelId);
  }

  @Post('channels/:channelId/read')
  async markAsRead(
    @CurrentUser('sub') userId: string,
    @Param('channelId') channelId: string,
    @Body() body: { messageId: string },
  ): Promise<{ success: boolean }> {
    await this.messagesService.markAsRead(channelId, userId, body.messageId);
    return { success: true };
  }

  @Get('messages/:id')
  async getMessage(
    @CurrentUser('sub') userId: string,
    @Param('id') messageId: string,
  ): Promise<MessageResponse> {
    const message = await this.messagesService.getMessageWithDetails(messageId);
    const isMember = await this.channelsService.isMember(
      message.channelId,
      userId,
    );
    if (!isMember) {
      throw new ForbiddenException('Access denied');
    }
    return message;
  }

  @Patch('messages/:id')
  async updateMessage(
    @CurrentUser('sub') userId: string,
    @Param('id') messageId: string,
    @Body() dto: UpdateMessageDto,
  ): Promise<MessageResponse> {
    const message = await this.messagesService.update(messageId, userId, dto);

    // Broadcast message update to all channel members via WebSocket
    this.websocketGateway.sendToChannel(
      message.channelId,
      WS_EVENTS.MESSAGE.UPDATED,
      message,
    );

    // Emit event for search indexing
    const channel = await this.channelsService.findById(message.channelId);
    if (channel) {
      this.eventEmitter.emit('message.updated', {
        message: {
          id: message.id,
          channelId: message.channelId,
          senderId: message.senderId,
          content: message.content,
          type: message.type,
          isPinned: message.isPinned,
          parentId: message.parentId,
          createdAt: message.createdAt,
        },
        channel: channel,
        sender: message.sender
          ? {
              id: message.sender.id,
              username: message.sender.username,
              displayName: message.sender.displayName,
            }
          : undefined,
      });
    }

    return message;
  }

  @Delete('messages/:id')
  async deleteMessage(
    @CurrentUser('sub') userId: string,
    @Param('id') messageId: string,
  ): Promise<{ success: boolean }> {
    const channelId = await this.messagesService.getMessageChannelId(messageId);
    await this.messagesService.delete(messageId, userId);

    // Broadcast message deletion to all channel members via WebSocket
    this.websocketGateway.sendToChannel(channelId, WS_EVENTS.MESSAGE.DELETED, {
      messageId,
    });

    // Emit event for search index removal
    this.eventEmitter.emit('message.deleted', messageId);

    return { success: true };
  }

  /**
   * Get thread with nested replies (max 2 levels)
   * Supports cursor-based pagination
   */
  @Get('messages/:id/thread')
  async getThread(
    @CurrentUser('sub') userId: string,
    @Param('id') messageId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<ThreadResponse> {
    const channelId = await this.messagesService.getMessageChannelId(messageId);
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Access denied');
    }
    return this.messagesService.getThread(
      messageId,
      limit ? parseInt(limit, 10) : 20,
      cursor,
    );
  }

  /**
   * Get sub-replies for a first-level reply (for expanding collapsed replies)
   * Supports cursor-based pagination
   */
  @Get('messages/:id/sub-replies')
  async getSubReplies(
    @CurrentUser('sub') userId: string,
    @Param('id') messageId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<SubRepliesResponse> {
    const channelId = await this.messagesService.getMessageChannelId(messageId);
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Access denied');
    }
    return this.messagesService.getSubReplies(
      messageId,
      limit ? parseInt(limit, 10) : 20,
      cursor,
    );
  }

  @Post('messages/:id/pin')
  async pinMessage(
    @CurrentUser('sub') userId: string,
    @Param('id') messageId: string,
  ): Promise<{ success: boolean }> {
    const channelId = await this.messagesService.getMessageChannelId(messageId);
    const role = await this.channelsService.getMemberRole(channelId, userId);
    if (!role || !['owner', 'admin'].includes(role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    await this.messagesService.pinMessage(messageId, true);
    return { success: true };
  }

  @Delete('messages/:id/pin')
  async unpinMessage(
    @CurrentUser('sub') userId: string,
    @Param('id') messageId: string,
  ): Promise<{ success: boolean }> {
    const channelId = await this.messagesService.getMessageChannelId(messageId);
    const role = await this.channelsService.getMemberRole(channelId, userId);
    if (!role || !['owner', 'admin'].includes(role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    await this.messagesService.pinMessage(messageId, false);
    return { success: true };
  }

  @Post('messages/:id/reactions')
  async addReaction(
    @CurrentUser('sub') userId: string,
    @Param('id') messageId: string,
    @Body() dto: AddReactionDto,
  ): Promise<{ success: boolean }> {
    await this.messagesService.addReaction(messageId, userId, dto.emoji);
    return { success: true };
  }

  @Delete('messages/:id/reactions/:emoji')
  async removeReaction(
    @CurrentUser('sub') userId: string,
    @Param('id') messageId: string,
    @Param('emoji') emoji: string,
  ): Promise<{ success: boolean }> {
    await this.messagesService.removeReaction(messageId, userId, emoji);
    return { success: true };
  }
}
