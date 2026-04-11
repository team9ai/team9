import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  Logger,
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

@Controller({
  path: 'im/messages/:messageId/properties',
  version: '1',
})
@UseGuards(AuthGuard, WorkspaceGuard, WorkspaceRoleGuard)
export class MessagePropertiesController {
  private readonly logger = new Logger(MessagePropertiesController.name);

  constructor(
    private readonly messagePropertiesService: MessagePropertiesService,
    private readonly aiAutoFillService: AiAutoFillService,
  ) {}

  /**
   * GET /v1/im/messages/:messageId/properties
   * Returns all properties for a message as key-value map.
   */
  @Get()
  async getAll(
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<Record<string, unknown>> {
    return this.messagePropertiesService.getProperties(messageId);
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
    await this.messagePropertiesService.batchSet(
      messageId,
      dto.properties,
      userId,
    );
    return { success: true };
  }

  /**
   * POST /v1/im/messages/:messageId/properties/auto-fill
   * Trigger AI auto-fill for message properties.
   * This is a background-style operation: it returns immediately with an accepted
   * status, and the actual fill happens asynchronously (results broadcast via WS).
   */
  @Post('auto-fill')
  @HttpCode(202)
  @WorkspaceRoles('member')
  autoFill(
    @CurrentUser('sub') userId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: AutoFillDto,
  ): { status: string } {
    // Fire and forget — results are broadcast via WebSocket
    this.aiAutoFillService
      .autoFill(messageId, userId, {
        fields: dto.fields,
        preserveExisting: dto.preserveExisting,
      })
      .catch((err: Error) => {
        this.logger.warn(`AI auto-fill failed: ${err.message}`);
      });
    return { status: 'accepted' };
  }
}
