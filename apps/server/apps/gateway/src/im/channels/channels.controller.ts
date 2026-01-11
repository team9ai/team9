import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import {
  ChannelsService,
  ChannelResponse,
  ChannelWithUnread,
  ChannelMemberResponse,
} from './channels.service.js';
import {
  CreateChannelDto,
  UpdateChannelDto,
  AddMemberDto,
  UpdateMemberDto,
  DeleteChannelDto,
} from './dto/index.js';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { CurrentTenantId } from '../../common/decorators/current-tenant.decorator.js';
import { WebsocketGateway } from '../websocket/websocket.gateway.js';
import { WS_EVENTS } from '../websocket/events/events.constants.js';

@Controller({
  path: 'im/channels',
  version: '1',
})
@UseGuards(AuthGuard)
export class ChannelsController {
  constructor(
    private readonly channelsService: ChannelsService,
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  @Get()
  async getMyChannels(
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string | undefined,
  ): Promise<ChannelWithUnread[]> {
    return this.channelsService.getUserChannels(userId, tenantId);
  }

  @Post()
  async createChannel(
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string | undefined,
    @Body() dto: CreateChannelDto,
  ): Promise<ChannelResponse> {
    const channel = await this.channelsService.create(dto, userId, tenantId);

    // Notify the creator about the new channel
    await this.websocketGateway.sendToUser(
      userId,
      WS_EVENTS.CHANNEL_CREATED,
      channel,
    );

    return channel;
  }

  @Post('direct/:targetUserId')
  async createDirectChannel(
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string | undefined,
    @Param('targetUserId') targetUserId: string,
  ): Promise<ChannelResponse> {
    const channel = await this.channelsService.createDirectChannel(
      userId,
      targetUserId,
      tenantId,
    );

    // Notify both users about the new DM channel so they can join the room
    await this.websocketGateway.sendToUser(
      targetUserId,
      WS_EVENTS.CHANNEL_CREATED,
      channel,
    );
    await this.websocketGateway.sendToUser(
      userId,
      WS_EVENTS.CHANNEL_CREATED,
      channel,
    );

    return channel;
  }

  @Get(':id')
  async getChannel(
    @CurrentUser('sub') userId: string,
    @Param('id') channelId: string,
  ): Promise<ChannelWithUnread> {
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Access denied');
    }
    return this.channelsService.findByIdOrThrow(channelId, userId);
  }

  @Patch(':id')
  async updateChannel(
    @CurrentUser('sub') userId: string,
    @Param('id') channelId: string,
    @Body() dto: UpdateChannelDto,
  ): Promise<ChannelResponse> {
    return this.channelsService.update(channelId, dto, userId);
  }

  @Get(':id/members')
  async getMembers(
    @CurrentUser('sub') userId: string,
    @Param('id') channelId: string,
  ): Promise<ChannelMemberResponse[]> {
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Access denied');
    }
    return this.channelsService.getChannelMembers(channelId);
  }

  @Post(':id/members')
  async addMember(
    @CurrentUser('sub') userId: string,
    @Param('id') channelId: string,
    @Body() dto: AddMemberDto,
  ): Promise<{ success: boolean }> {
    const role = await this.channelsService.getMemberRole(channelId, userId);
    if (!role || !['owner', 'admin'].includes(role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    await this.channelsService.addMember(
      channelId,
      dto.userId,
      dto.role || 'member',
    );
    return { success: true };
  }

  @Patch(':id/members/:memberId')
  async updateMember(
    @CurrentUser('sub') userId: string,
    @Param('id') channelId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberDto,
  ): Promise<{ success: boolean }> {
    await this.channelsService.updateMember(channelId, memberId, dto, userId);
    return { success: true };
  }

  @Delete(':id/members/:memberId')
  async removeMember(
    @CurrentUser('sub') userId: string,
    @Param('id') channelId: string,
    @Param('memberId') memberId: string,
  ): Promise<{ success: boolean }> {
    await this.channelsService.removeMember(channelId, memberId, userId);
    return { success: true };
  }

  @Post(':id/leave')
  async leaveChannel(
    @CurrentUser('sub') userId: string,
    @Param('id') channelId: string,
  ): Promise<{ success: boolean }> {
    await this.channelsService.removeMember(channelId, userId, userId);
    return { success: true };
  }

  @Delete(':id')
  async deleteChannel(
    @CurrentUser('sub') userId: string,
    @Param('id') channelId: string,
    @Body() dto: DeleteChannelDto,
  ): Promise<{ success: boolean }> {
    // Get member IDs and channel info before deletion
    const memberIds = await this.channelsService.getChannelMemberIds(channelId);
    const channel = await this.channelsService.findById(channelId);

    if (dto.permanent) {
      // Hard delete
      await this.channelsService.deleteChannel(
        channelId,
        userId,
        dto.confirmationName,
      );

      // Notify all members about deletion
      for (const memberId of memberIds) {
        await this.websocketGateway.sendToUser(
          memberId,
          WS_EVENTS.CHANNEL_DELETED,
          {
            channelId,
            channelName: channel?.name,
            deletedBy: userId,
          },
        );
      }
    } else {
      // Soft delete (archive)
      await this.channelsService.archiveChannel(channelId, userId);

      // Notify all members about archival
      for (const memberId of memberIds) {
        await this.websocketGateway.sendToUser(
          memberId,
          WS_EVENTS.CHANNEL_ARCHIVED,
          {
            channelId,
            channelName: channel?.name,
            archivedBy: userId,
          },
        );
      }
    }

    return { success: true };
  }

  @Post(':id/unarchive')
  async unarchiveChannel(
    @CurrentUser('sub') userId: string,
    @Param('id') channelId: string,
  ): Promise<ChannelResponse> {
    const channel = await this.channelsService.unarchiveChannel(
      channelId,
      userId,
    );

    // Notify members
    const memberIds = await this.channelsService.getChannelMemberIds(channelId);
    for (const memberId of memberIds) {
      await this.websocketGateway.sendToUser(
        memberId,
        WS_EVENTS.CHANNEL_UNARCHIVED,
        {
          channelId,
          channelName: channel.name,
          unarchivedBy: userId,
        },
      );
    }

    return channel;
  }
}
