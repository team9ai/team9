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
} from '@nestjs/common';
import {
  ChannelsService,
  ChannelResponse,
  ChannelWithUnread,
  ChannelMemberResponse,
} from './channels.service';
import {
  CreateChannelDto,
  UpdateChannelDto,
  AddMemberDto,
  UpdateMemberDto,
} from './dto';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('api/im/channels')
@UseGuards(AuthGuard)
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get()
  async getMyChannels(
    @CurrentUser('sub') userId: string,
  ): Promise<ChannelWithUnread[]> {
    return this.channelsService.getUserChannels(userId);
  }

  @Post()
  async createChannel(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateChannelDto,
  ): Promise<ChannelResponse> {
    return this.channelsService.create(dto, userId);
  }

  @Post('direct/:targetUserId')
  async createDirectChannel(
    @CurrentUser('sub') userId: string,
    @Param('targetUserId') targetUserId: string,
  ): Promise<ChannelResponse> {
    return this.channelsService.createDirectChannel(userId, targetUserId);
  }

  @Get(':id')
  async getChannel(
    @CurrentUser('sub') userId: string,
    @Param('id') channelId: string,
  ): Promise<ChannelResponse> {
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Access denied');
    }
    return this.channelsService.findByIdOrThrow(channelId);
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
}
