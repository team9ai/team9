import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Inject,
  forwardRef,
  ParseUUIDPipe,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { TabsService } from './tabs.service.js';
import { CreateTabDto } from './dto/create-tab.dto.js';
import { UpdateTabDto, ReorderTabsDto } from './dto/update-tab.dto.js';
import { AuthGuard, CurrentUser } from '@team9/auth';
import {
  WorkspaceGuard,
  WorkspaceRoleGuard,
  WorkspaceRoles,
} from '../../workspace/guards/index.js';
import { WebsocketGateway } from '../websocket/websocket.gateway.js';
import { WS_EVENTS } from '../websocket/events/events.constants.js';
import type { ChannelTab } from '@team9/database/schemas';
import { ChannelsService } from '../channels/channels.service.js';

@Controller({
  path: 'im/channels/:channelId/tabs',
  version: '1',
})
@UseGuards(AuthGuard, WorkspaceGuard, WorkspaceRoleGuard)
export class TabsController {
  constructor(
    private readonly tabsService: TabsService,
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway: WebsocketGateway,
    private readonly channelsService: ChannelsService,
  ) {}

  @Get()
  async getAll(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<ChannelTab[]> {
    await this.channelsService.assertReadAccess(channelId, userId);

    const tabs = await this.tabsService.findAllByChannel(channelId);

    // Lazy backfill: public/private channels created before the tabs feature
    // shipped have no built-in tabs. Seed Messages + Files on first read so
    // that existing channels heal silently without needing a data migration.
    if (tabs.length === 0) {
      const channel = await this.channelsService.findById(channelId);
      if (
        channel &&
        (channel.type === 'public' || channel.type === 'private')
      ) {
        await this.tabsService.seedBuiltinTabs(channelId);
        return this.tabsService.findAllByChannel(channelId);
      }
    }

    return tabs;
  }

  @Post()
  @WorkspaceRoles('member')
  async create(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: CreateTabDto,
  ): Promise<ChannelTab> {
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this channel');
    }
    const tab = await this.tabsService.create(channelId, dto, userId);

    await this.websocketGateway.sendToChannelMembers(
      channelId,
      WS_EVENTS.TAB.CREATED,
      { channelId, tab },
    );

    return tab;
  }

  @Patch('order')
  @WorkspaceRoles('member')
  async reorder(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: ReorderTabsDto,
  ): Promise<ChannelTab[]> {
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this channel');
    }
    await this.tabsService.reorder(channelId, dto.tabIds);
    return this.tabsService.findAllByChannel(channelId);
  }

  @Patch(':tabId')
  @WorkspaceRoles('member')
  async update(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('tabId', ParseUUIDPipe) tabId: string,
    @Body() dto: UpdateTabDto,
  ): Promise<ChannelTab> {
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this channel');
    }
    // Verify the tab belongs to this channel
    const existing = await this.tabsService.findByIdOrThrow(tabId);
    if (existing.channelId !== channelId) {
      throw new NotFoundException('Tab not found');
    }

    const tab = await this.tabsService.update(tabId, dto);

    await this.websocketGateway.sendToChannelMembers(
      channelId,
      WS_EVENTS.TAB.UPDATED,
      { channelId, tabId, changes: dto },
    );

    return tab;
  }

  @Delete(':tabId')
  @WorkspaceRoles('member')
  async delete(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('tabId', ParseUUIDPipe) tabId: string,
  ): Promise<{ success: boolean }> {
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this channel');
    }
    // Verify the tab belongs to this channel
    const existing = await this.tabsService.findByIdOrThrow(tabId);
    if (existing.channelId !== channelId) {
      throw new NotFoundException('Tab not found');
    }

    await this.tabsService.delete(tabId);

    await this.websocketGateway.sendToChannelMembers(
      channelId,
      WS_EVENTS.TAB.DELETED,
      { channelId, tabId },
    );

    return { success: true };
  }
}
