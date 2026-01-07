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
import { v4 as uuidv4 } from 'uuid';
import { MessagesService, MessageResponse } from './messages.service.js';
import {
  CreateMessageDto,
  UpdateMessageDto,
  AddReactionDto,
} from './dto/index.js';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { ChannelsService } from '../channels/channels.service.js';
import { WebsocketGateway } from '../websocket/websocket.gateway.js';
import { WS_EVENTS } from '../websocket/events/events.constants.js';
import { LogicClientService } from '../services/logic-client.service.js';

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
    @Optional() private readonly logicClientService?: LogicClientService,
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
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Access denied');
    }

    // Use Logic Service HTTP API if available (new architecture)
    if (this.logicClientService) {
      const clientMsgId = uuidv4();

      try {
        const result = await this.logicClientService.createMessage({
          clientMsgId,
          channelId,
          senderId: userId,
          content: dto.content,
          parentId: dto.parentId,
          type: 'text',
        });

        // Fetch the full message details for response
        // Note: Message broadcast to channel is handled by OutboxProcessor
        const message = await this.messagesService.getMessageWithDetails(
          result.msgId,
        );

        return message;
      } catch (error) {
        this.logger.error(
          `Failed to create message via Logic service: ${error}`,
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
