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
import {
  PropertyDefinitionsService,
  PropertyDefinitionRow,
} from './property-definitions.service.js';
import {
  CreatePropertyDefinitionDto,
  UpdatePropertyDefinitionDto,
  ReorderPropertyDefinitionsDto,
} from './dto/index.js';
import { AuthGuard, CurrentUser } from '@team9/auth';
import {
  WorkspaceGuard,
  WorkspaceRoleGuard,
  WorkspaceRoles,
} from '../../workspace/guards/index.js';
import { WebsocketGateway } from '../websocket/websocket.gateway.js';
import { WS_EVENTS } from '../websocket/events/events.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { ChannelsService } from '../channels/channels.service.js';

@Controller({
  path: 'im/channels/:channelId/property-definitions',
  version: '1',
})
@UseGuards(AuthGuard, WorkspaceGuard, WorkspaceRoleGuard)
export class PropertyDefinitionsController {
  constructor(
    private readonly propertyDefinitionsService: PropertyDefinitionsService,
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway: WebsocketGateway,
    private readonly auditService: AuditService,
    private readonly channelsService: ChannelsService,
  ) {}

  @Get()
  async getAll(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<PropertyDefinitionRow[]> {
    await this.channelsService.assertReadAccess(channelId, userId);
    return this.propertyDefinitionsService.findAllByChannel(channelId);
  }

  @Post()
  @WorkspaceRoles('member')
  async create(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: CreatePropertyDefinitionDto,
  ): Promise<PropertyDefinitionRow> {
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this channel');
    }
    const definition = await this.propertyDefinitionsService.create(
      channelId,
      dto,
      userId,
    );

    await this.auditService.log({
      channelId,
      entityType: 'channel',
      entityId: channelId,
      action: 'property_defined',
      changes: {
        [definition.key]: { old: null, new: definition },
      },
      performedBy: userId,
    });

    await this.websocketGateway.sendToChannelMembers(
      channelId,
      WS_EVENTS.PROPERTY.DEFINITION_CREATED,
      { channelId, definition },
    );

    return definition;
  }

  @Patch('order')
  @WorkspaceRoles('member')
  async reorder(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: ReorderPropertyDefinitionsDto,
  ): Promise<PropertyDefinitionRow[]> {
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this channel');
    }
    const result = await this.propertyDefinitionsService.reorder(
      channelId,
      dto.definitionIds,
    );

    // Broadcast so clients know to refetch definitions
    await this.websocketGateway.sendToChannelMembers(
      channelId,
      WS_EVENTS.PROPERTY.DEFINITION_UPDATED,
      {
        channelId,
        definitionId: null,
        changes: { order: { old: null, new: 'reordered' } },
      },
    );

    return result;
  }

  @Patch(':id')
  @WorkspaceRoles('member')
  async update(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropertyDefinitionDto,
  ): Promise<PropertyDefinitionRow> {
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this channel');
    }
    // Verify the definition belongs to this channel
    const existing = await this.propertyDefinitionsService.findByIdOrThrow(id);
    if (existing.channelId !== channelId) {
      throw new NotFoundException('Property definition not found');
    }

    const definition = await this.propertyDefinitionsService.update(id, dto);

    // Build old/new changes from the DTO fields that were actually provided
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    for (const [field, newValue] of Object.entries(dto)) {
      changes[field] = {
        old: existing[field as keyof typeof existing] ?? null,
        new: newValue,
      };
    }

    await this.auditService.log({
      channelId,
      entityType: 'channel',
      entityId: channelId,
      action: 'property_schema_updated',
      changes,
      performedBy: userId,
      metadata: { definitionId: id, key: existing.key },
    });

    await this.websocketGateway.sendToChannelMembers(
      channelId,
      WS_EVENTS.PROPERTY.DEFINITION_UPDATED,
      { channelId, definitionId: id, changes: dto },
    );

    return definition;
  }

  @Delete(':id')
  @WorkspaceRoles('member')
  async delete(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ success: boolean }> {
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this channel');
    }
    // Verify the definition belongs to this channel
    const existing = await this.propertyDefinitionsService.findByIdOrThrow(id);
    if (existing.channelId !== channelId) {
      throw new NotFoundException('Property definition not found');
    }

    await this.propertyDefinitionsService.delete(id);

    await this.auditService.log({
      channelId,
      entityType: 'channel',
      entityId: channelId,
      action: 'property_deleted',
      changes: {
        [existing.key]: { old: existing, new: null },
      },
      performedBy: userId,
      metadata: { definitionId: id, key: existing.key },
    });

    await this.websocketGateway.sendToChannelMembers(
      channelId,
      WS_EVENTS.PROPERTY.DEFINITION_DELETED,
      { channelId, definitionId: id },
    );

    return { success: true };
  }
}
