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
} from '@nestjs/common';
import { MessagesService, MessageResponse } from './messages.service';
import { CreateMessageDto, UpdateMessageDto, AddReactionDto } from './dto';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ChannelsService } from '../channels/channels.service';

@Controller('api/im')
@UseGuards(AuthGuard)
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly channelsService: ChannelsService,
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
    return this.messagesService.create(channelId, userId, dto);
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
    return this.messagesService.update(messageId, userId, dto);
  }

  @Delete('messages/:id')
  async deleteMessage(
    @CurrentUser('sub') userId: string,
    @Param('id') messageId: string,
  ): Promise<{ success: boolean }> {
    await this.messagesService.delete(messageId, userId);
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
