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
import { v7 as uuidv7 } from 'uuid';
import { MessagesService, MessageResponse } from './messages.service.js';
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
import { ImWorkerClientService } from '../services/im-worker-client.service.js';

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
    @Optional() private readonly imWorkerClientService?: ImWorkerClientService,
    @Optional() private readonly gatewayMQService?: GatewayMQService,
  ) {}

  @Get('channels/:channelId/messages')
  async getChannelMessages(
    @CurrentUser('sub') userId: string,
    @Param('channelId') channelId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ): Promise<MessageResponse[]> {
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Access denied');
    }
    return this.messagesService.getChannelMessages(
      channelId,
      limit ? parseInt(limit, 10) : 50,
      before,
    );
  }

  @Post('channels/:channelId/messages')
  async createMessage(
    @CurrentUser('sub') userId: string,
    @Param('channelId') channelId: string,
    @Body() dto: CreateMessageDto,
  ): Promise<MessageResponse> {
    //todo 做成装饰器
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Access denied');
    }

    // Use IM Worker Service HTTP API if available (new architecture with hybrid mode)
    if (this.imWorkerClientService) {
      const clientMsgId = uuidv7();

      // Get workspaceId (tenantId) from channel for offline message routing
      const channel = await this.channelsService.findById(channelId);
      const workspaceId = channel?.tenantId ?? undefined;

      // Determine message type based on attachments
      const messageType = dto.attachments?.length ? 'file' : 'text';

      try {
        const result = await this.imWorkerClientService.createMessage({
          clientMsgId,
          channelId,
          senderId: userId,
          content: dto.content,
          parentId: dto.parentId,
          type: messageType,
          workspaceId,
          attachments: dto.attachments,
        });

        // Fetch the full message details for response
        const message = await this.messagesService.getMessageWithDetails(
          result.msgId,
        );

        // Hybrid Mode: Immediately broadcast to online users via Socket.io Redis Adapter
        // This provides low-latency delivery (~10ms) for online users
        this.websocketGateway.sendToChannel(
          channelId,
          WS_EVENTS.NEW_MESSAGE,
          message,
        );

        const broadcastAt = Date.now();

        // Send post-broadcast task to IM Worker Service via RabbitMQ (event-driven)
        // This handles: offline messages, unread counts, outbox completion
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
        }

        this.logger.debug(
          `Message ${result.msgId} persisted and broadcast immediately`,
        );

        return message;
      } catch (error) {
        this.logger.error(
          `Failed to create message via IM Worker service: ${error}`,
        );
        // Fall through to legacy path on error
      }
    }

    // Fallback to legacy direct DB write
    const message = await this.messagesService.create(channelId, userId, dto);

    // Broadcast new message to all channel members via WebSocket (legacy path only)
    this.websocketGateway.sendToChannel(
      channelId,
      WS_EVENTS.NEW_MESSAGE,
      message,
    );

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
      WS_EVENTS.MESSAGE_UPDATED,
      message,
    );

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
    this.websocketGateway.sendToChannel(channelId, WS_EVENTS.MESSAGE_DELETED, {
      messageId,
    });

    return { success: true };
  }

  @Get('messages/:id/thread')
  async getThreadReplies(
    @CurrentUser('sub') userId: string,
    @Param('id') messageId: string,
    @Query('limit') limit?: string,
  ): Promise<MessageResponse[]> {
    const channelId = await this.messagesService.getMessageChannelId(messageId);
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Access denied');
    }
    return this.messagesService.getThreadReplies(
      messageId,
      limit ? parseInt(limit, 10) : 50,
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

  @Get('mentions')
  async getMyMentions(
    @CurrentUser('sub') userId: string,
    @Query('limit') limit?: string,
  ): Promise<MessageResponse[]> {
    return this.messagesService.getUserMentions(
      userId,
      limit ? parseInt(limit, 10) : 50,
    );
  }
}
