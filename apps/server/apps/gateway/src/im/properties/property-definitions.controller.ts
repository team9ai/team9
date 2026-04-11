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
  ) {}

  @Get()
  async getAll(
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<PropertyDefinitionRow[]> {
    return this.propertyDefinitionsService.findAllByChannel(channelId);
  }

  @Post()
  @WorkspaceRoles('member')
  async create(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: CreatePropertyDefinitionDto,
  ): Promise<PropertyDefinitionRow> {
    const definition = await this.propertyDefinitionsService.create(
      channelId,
      dto,
      userId,
    );

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
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: ReorderPropertyDefinitionsDto,
  ): Promise<PropertyDefinitionRow[]> {
    return this.propertyDefinitionsService.reorder(
      channelId,
      dto.definitionIds,
    );
  }

  @Patch(':id')
  @WorkspaceRoles('member')
  async update(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropertyDefinitionDto,
  ): Promise<PropertyDefinitionRow> {
    const definition = await this.propertyDefinitionsService.update(id, dto);

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
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ success: boolean }> {
    await this.propertyDefinitionsService.delete(id);

    await this.websocketGateway.sendToChannelMembers(
      channelId,
      WS_EVENTS.PROPERTY.DEFINITION_DELETED,
      { channelId, definitionId: id },
    );

    return { success: true };
  }

  @Post('seed')
  @WorkspaceRoles('member')
  async seedNative(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<PropertyDefinitionRow[]> {
    return this.propertyDefinitionsService.seedNativeProperties(
      channelId,
      userId,
    );
  }
}
