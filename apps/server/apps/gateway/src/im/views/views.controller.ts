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
  ParseIntPipe,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
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
import { ChannelsService } from '../channels/channels.service.js';

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
    private readonly channelsService: ChannelsService,
  ) {}

  @Get()
  async getAll(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<ChannelView[]> {
    await this.channelsService.assertReadAccess(channelId, userId);
    return this.viewsService.findAllByChannel(channelId);
  }

  @Post()
  @WorkspaceRoles('member')
  async create(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: CreateViewDto,
  ): Promise<ChannelView> {
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this channel');
    }
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
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('viewId', ParseUUIDPipe) viewId: string,
    @Body() dto: UpdateViewDto,
  ): Promise<ChannelView> {
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this channel');
    }
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
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('viewId', ParseUUIDPipe) viewId: string,
  ): Promise<{ success: boolean }> {
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this channel');
    }
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
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('viewId', ParseUUIDPipe) viewId: string,
    @Query() query: QueryViewMessagesDto,
  ) {
    await this.channelsService.assertReadAccess(channelId, userId);
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

  /**
   * GET /v1/im/channels/:channelId/views/:viewId/tree
   * Returns a hierarchy tree snapshot for the view.
   *
   * Query params:
   *   maxDepth    – max levels to expand (1–5, default: 3). Rejected > 5.
   *   expandedIds – comma-separated message IDs for which to eagerly load one extra level.
   *   cursor      – opaque cursor (message ID) for pagination.
   *   limit       – page size (1–100, default: 50). Rejected > 100.
   *   filter      – JSON-encoded ViewFilter[] (optional).
   *   sort        – JSON-encoded ViewSort[] (optional).
   */
  @Get(':viewId/tree')
  async getTree(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('viewId', ParseUUIDPipe) viewId: string,
    @Query('maxDepth', new ParseIntPipe({ optional: true })) maxDepth = 3,
    @Query('expandedIds') expandedIdsRaw?: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('filter') filterRaw?: string,
    @Query('sort') sortRaw?: string,
  ) {
    if (maxDepth > 5) {
      throw new BadRequestException('maxDepth must be <= 5');
    }
    if (limit > 100) {
      throw new BadRequestException('limit must be <= 100');
    }

    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const expandedIds = expandedIdsRaw
      ? expandedIdsRaw.split(',').filter(Boolean)
      : [];

    for (const id of expandedIds) {
      if (!UUID_RE.test(id)) {
        throw new BadRequestException(
          `Invalid expandedIds entry: "${id}" is not a valid UUID`,
        );
      }
    }

    if (cursor && !UUID_RE.test(cursor)) {
      throw new BadRequestException('Invalid cursor: must be a valid UUID');
    }

    let filter: unknown;
    let sort: unknown;
    try {
      if (filterRaw) filter = JSON.parse(filterRaw);
      if (sortRaw) sort = JSON.parse(sortRaw);
    } catch {
      throw new BadRequestException('filter/sort must be valid JSON');
    }

    await this.channelsService.assertReadAccess(channelId, userId);
    const view = await this.viewsService.findByIdOrThrow(viewId);
    if (view.channelId !== channelId) {
      throw new NotFoundException('View not found');
    }

    return this.viewsService.getTreeSnapshot({
      channelId,
      viewId,
      maxDepth,
      limit,
      cursor: cursor ?? null,
      expandedIds,
      filter,
      sort,
    });
  }
}
