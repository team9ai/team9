import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  ParseIntPipe,
  ForbiddenException,
} from '@nestjs/common';
import { MessagePropertiesService } from './message-properties.service.js';
import { AiAutoFillService } from './ai-auto-fill.service.js';
import {
  SetPropertyValueDto,
  BatchSetPropertiesDto,
  AutoFillDto,
} from './dto/index.js';
import { AuthGuard, CurrentUser } from '@team9/auth';
import {
  WorkspaceGuard,
  WorkspaceRoleGuard,
  WorkspaceRoles,
} from '../../workspace/guards/index.js';
import { CurrentTenantId } from '../../common/decorators/current-tenant.decorator.js';
import { ChannelsService } from '../channels/channels.service.js';

@Controller({
  path: 'im/messages/:messageId/properties',
  version: '1',
})
@UseGuards(AuthGuard, WorkspaceGuard, WorkspaceRoleGuard)
export class MessagePropertiesController {
  constructor(
    private readonly messagePropertiesService: MessagePropertiesService,
    private readonly aiAutoFillService: AiAutoFillService,
    private readonly channelsService: ChannelsService,
  ) {}

  /**
   * GET /v1/im/messages/:messageId/properties
   * Returns all properties for a message as key-value map.
   */
  @Get()
  async getAll(
    @CurrentUser('sub') userId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<Record<string, unknown>> {
    const channelId =
      await this.messagePropertiesService.getMessageChannelId(messageId);
    await this.channelsService.assertReadAccess(channelId, userId);
    return this.messagePropertiesService.getProperties(messageId, {
      excludeHidden: true,
    });
  }

  /**
   * GET /v1/im/messages/:messageId/properties/relations
   * Inspect all relation edges for a message (incoming + outgoing).
   *
   * Query params:
   *   kind       – 'parent' | 'related' | 'all' (default: 'all')
   *   direction  – 'outgoing' | 'incoming' | 'both' (default: 'both')
   *   depth      – 1–10, how deep to walk the parent chain (default: 1)
   */
  @Get('relations')
  async getRelations(
    @CurrentUser('sub') userId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Query('kind') kind?: 'parent' | 'related' | 'all',
    @Query('direction') direction?: 'outgoing' | 'incoming' | 'both',
    @Query('depth', new ParseIntPipe({ optional: true })) depth?: number,
  ) {
    const channelId =
      await this.messagePropertiesService.getMessageChannelId(messageId);
    await this.channelsService.assertReadAccess(channelId, userId);
    return this.messagePropertiesService.getRelationsInspection(messageId, {
      kind,
      direction,
      depth,
    });
  }

  /**
   * PUT /v1/im/messages/:messageId/properties/:definitionId
   * Set a single property value with type validation.
   */
  @Put(':definitionId')
  @WorkspaceRoles('member')
  async set(
    @CurrentUser('sub') userId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Param('definitionId', ParseUUIDPipe) definitionId: string,
    @Body() dto: SetPropertyValueDto,
  ): Promise<{ success: boolean }> {
    const channelId =
      await this.messagePropertiesService.getMessageChannelId(messageId);
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this channel');
    }
    await this.messagePropertiesService.setProperty(
      messageId,
      definitionId,
      dto.value,
      userId,
    );
    return { success: true };
  }

  /**
   * DELETE /v1/im/messages/:messageId/properties/:definitionId
   * Remove a property value.
   */
  @Delete(':definitionId')
  @WorkspaceRoles('member')
  async remove(
    @CurrentUser('sub') userId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Param('definitionId', ParseUUIDPipe) definitionId: string,
  ): Promise<{ success: boolean }> {
    const channelId =
      await this.messagePropertiesService.getMessageChannelId(messageId);
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this channel');
    }
    await this.messagePropertiesService.removeProperty(
      messageId,
      definitionId,
      userId,
    );
    return { success: true };
  }

  /**
   * PATCH /v1/im/messages/:messageId/properties
   * Batch set multiple properties by key.
   */
  @Patch()
  @WorkspaceRoles('member')
  async batchSet(
    @CurrentUser('sub') userId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: BatchSetPropertiesDto,
  ): Promise<{ success: boolean }> {
    const channelId =
      await this.messagePropertiesService.getMessageChannelId(messageId);
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this channel');
    }
    await this.messagePropertiesService.batchSet(
      messageId,
      dto.properties,
      userId,
    );
    return { success: true };
  }

  /**
   * POST /v1/im/messages/:messageId/properties/auto-fill
   * Trigger AI auto-fill for message properties. Runs synchronously so the
   * caller sees the actual outcome (filled values, skipped fields, or errors)
   * rather than a silent 202 that hides empty returns and AI failures.
   */
  @Post('auto-fill')
  @WorkspaceRoles('member')
  async autoFill(
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: AutoFillDto,
  ): Promise<{ filled: Record<string, unknown>; skipped: string[] }> {
    const channelId =
      await this.messagePropertiesService.getMessageChannelId(messageId);
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this channel');
    }
    return this.aiAutoFillService.autoFill(messageId, userId, tenantId, {
      fields: dto.fields,
      preserveExisting: dto.preserveExisting,
    });
  }
}
