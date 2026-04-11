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
  ) {}

  @Get()
  async getAll(
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<ChannelTab[]> {
    return this.tabsService.findAllByChannel(channelId);
  }

  @Post()
  @WorkspaceRoles('member')
  async create(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: CreateTabDto,
  ): Promise<ChannelTab> {
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
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: ReorderTabsDto,
  ): Promise<ChannelTab[]> {
    await this.tabsService.reorder(channelId, dto.tabIds);
    return this.tabsService.findAllByChannel(channelId);
  }

  @Patch(':tabId')
  @WorkspaceRoles('member')
  async update(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('tabId', ParseUUIDPipe) tabId: string,
    @Body() dto: UpdateTabDto,
  ): Promise<ChannelTab> {
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
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('tabId', ParseUUIDPipe) tabId: string,
  ): Promise<{ success: boolean }> {
    await this.tabsService.delete(tabId);

    await this.websocketGateway.sendToChannelMembers(
      channelId,
      WS_EVENTS.TAB.DELETED,
      { channelId, tabId },
    );

    return { success: true };
  }
}
