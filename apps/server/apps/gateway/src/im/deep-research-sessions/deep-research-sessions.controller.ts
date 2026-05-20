import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { CurrentTenantId } from '../../common/decorators/current-tenant.decorator.js';
import { DeepResearchSessionsService } from './deep-research-sessions.service.js';
import { DeepResearchSessionActionDto } from './dto/deep-research-session-action.dto.js';
import type { MessageResponse } from '../messages/messages.service.js';

@Controller({
  path: 'im/deep-research-sessions',
  version: '1',
})
@UseGuards(AuthGuard)
export class DeepResearchSessionsController {
  constructor(private readonly service: DeepResearchSessionsService) {}

  @Post(':channelId/actions')
  async action(
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string | undefined,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: DeepResearchSessionActionDto,
  ): Promise<{ accepted: true }> {
    return this.service.handleAction({
      userId,
      tenantId: tenantId ?? null,
      childChannelId: channelId,
      action: dto.action,
      planMessageId: dto.planMessageId,
      planInteractionId: dto.planInteractionId,
      ...(dto.input ? { input: dto.input } : {}),
    });
  }

  @Get(':channelId/context')
  async context(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Query('limit') limitRaw?: string,
  ): Promise<{ channelId: string; messages: MessageResponse[] }> {
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    return this.service.getContext({
      userId,
      childChannelId: channelId,
      ...(Number.isFinite(limit) ? { limit } : {}),
    });
  }
}
