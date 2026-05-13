import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { CurrentTenantId } from '../../common/decorators/current-tenant.decorator.js';
import { TopicSessionsService } from './topic-sessions.service.js';
import { CreateTopicSessionDto } from './dto/create-topic-session.dto.js';
import type {
  TopicSessionGroup,
  TopicSessionResponse,
} from './dto/topic-session.response.js';

const MAX_GROUPED_TOPIC_SESSIONS_PER_AGENT = 1000;

@Controller({
  path: 'im/topic-sessions',
  version: '1',
})
@UseGuards(AuthGuard)
export class TopicSessionsController {
  constructor(private readonly service: TopicSessionsService) {}

  @Post()
  async create(
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string | undefined,
    @Body() dto: CreateTopicSessionDto,
  ): Promise<TopicSessionResponse> {
    // Cross-field check: at least one of initialMessage / attachments must
    // be present. Lives here rather than in the DTO because @ValidateIf
    // would gate ALL of initialMessage's validators (IsString/MaxLength)
    // when attachments are present, opening a type-bypass.
    const hasContent = !!dto.initialMessage?.trim();
    const hasAttachments = !!dto.attachments?.length;
    if (!hasContent && !hasAttachments) {
      throw new BadRequestException(
        'Either initialMessage or at least one attachment is required',
      );
    }

    return this.service.create({
      creatorId: userId,
      tenantId: tenantId ?? null,
      botUserId: dto.botUserId,
      initialMessage: dto.initialMessage,
      ...(dto.model ? { model: dto.model } : {}),
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.attachments?.length ? { attachments: dto.attachments } : {}),
    });
  }

  /**
   * Grouped sidebar view: for each agent the caller has a topic session
   * (or legacy DM) with, return the N most recent topic sessions and a
   * pointer to the legacy direct channel.
   */
  @Get('grouped')
  async grouped(
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string | undefined,
    @Query('perAgent') perAgentRaw?: string,
  ): Promise<TopicSessionGroup[]> {
    const n = this.parsePerAgent(perAgentRaw);
    return this.service.listGrouped(userId, tenantId, n);
  }

  @Delete(':channelId')
  async delete(
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string | undefined,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<{ ok: true }> {
    await this.service.delete({
      userId,
      tenantId: tenantId ?? null,
      channelId,
    });
    return { ok: true };
  }

  private parsePerAgent(raw: string | undefined): number {
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isFinite(parsed) || parsed < 1) return 5;
    return Math.min(parsed, MAX_GROUPED_TOPIC_SESSIONS_PER_AGENT);
  }
}
