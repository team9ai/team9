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
  Inject,
  forwardRef,
  ParseUUIDPipe,
  NotFoundException,
} from '@nestjs/common';
import { ViewsService } from './views.service.js';
import { CreateViewDto } from './dto/create-view.dto.js';
import { UpdateViewDto } from './dto/update-view.dto.js';
import { QueryViewMessagesDto } from './dto/query-view-messages.dto.js';
import { AuthGuard, CurrentUser } from '@team9/auth';
import {
  WorkspaceGuard,
  WorkspaceRoleGuard,
  WorkspaceRoles,
} from '../../workspace/guards/index.js';
import { WebsocketGateway } from '../websocket/websocket.gateway.js';
import { WS_EVENTS } from '../websocket/events/events.constants.js';
import type { ChannelView } from '@team9/database/schemas';

@Controller({
  path: 'im/channels/:channelId/views',
  version: '1',
})
@UseGuards(AuthGuard, WorkspaceGuard, WorkspaceRoleGuard)
export class ViewsController {
  constructor(
    private readonly viewsService: ViewsService,
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  @Get()
  async getAll(
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<ChannelView[]> {
    return this.viewsService.findAllByChannel(channelId);
  }

  @Post()
  @WorkspaceRoles('member')
  async create(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: CreateViewDto,
  ): Promise<ChannelView> {
    const view = await this.viewsService.create(channelId, dto, userId);

    await this.websocketGateway.sendToChannelMembers(
      channelId,
      WS_EVENTS.VIEW.CREATED,
      { channelId, view },
    );

    return view;
  }

  @Patch(':viewId')
  @WorkspaceRoles('member')
  async update(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('viewId', ParseUUIDPipe) viewId: string,
    @Body() dto: UpdateViewDto,
  ): Promise<ChannelView> {
    // Verify the view belongs to this channel
    const existing = await this.viewsService.findByIdOrThrow(viewId);
    if (existing.channelId !== channelId) {
      throw new NotFoundException('View not found');
    }

    const view = await this.viewsService.update(viewId, dto);

    await this.websocketGateway.sendToChannelMembers(
      channelId,
      WS_EVENTS.VIEW.UPDATED,
      { channelId, viewId, changes: dto },
    );

    return view;
  }

  @Delete(':viewId')
  @WorkspaceRoles('member')
  async delete(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('viewId', ParseUUIDPipe) viewId: string,
  ): Promise<{ success: boolean }> {
    // Verify the view belongs to this channel
    const existing = await this.viewsService.findByIdOrThrow(viewId);
    if (existing.channelId !== channelId) {
      throw new NotFoundException('View not found');
    }

    await this.viewsService.delete(viewId);

    await this.websocketGateway.sendToChannelMembers(
      channelId,
      WS_EVENTS.VIEW.DELETED,
      { channelId, viewId },
    );

    return { success: true };
  }

  @Get(':viewId/messages')
  async queryMessages(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('viewId', ParseUUIDPipe) viewId: string,
    @Query() query: QueryViewMessagesDto,
  ) {
    const view = await this.viewsService.findByIdOrThrow(viewId);
    if (view.channelId !== channelId) {
      throw new NotFoundException('View not found');
    }
    return this.viewsService.queryMessages(viewId, {
      limit: query.limit,
      cursor: query.cursor,
      group: query.group,
    });
  }
}
