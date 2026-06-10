import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { createHash } from 'crypto';
import {
  DATABASE_CONNECTION,
  and,
  eq,
  isNull,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { InternalAuthGuard } from '../../auth/internal-auth.guard.js';
import { ChannelsService } from '../channels/channels.service.js';
import { WebsocketGateway } from '../websocket/websocket.gateway.js';
import { WS_EVENTS } from '../websocket/events/events.constants.js';
import { MessagesService } from './messages.service.js';
import {
  IngestExternalMessageDto,
  type IngestExternalMessageResponse,
} from './dto/ingest-external-message.dto.js';

@UseGuards(InternalAuthGuard)
@Controller({
  path: 'internal/im/external',
  version: '1',
})
export class ExternalMessagesInternalController {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly channelsService: ChannelsService,
    private readonly messagesService: MessagesService,
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  @Post('messages')
  @HttpCode(HttpStatus.OK)
  async ingestExternalMessage(
    @Body() dto: IngestExternalMessageDto,
  ): Promise<IngestExternalMessageResponse> {
    const { message, binding } = dto;
    const clientMsgId = this.clientMsgIdFor(message.idempotencyKey);
    const existing =
      await this.messagesService.getExternalMessageByClientMsgId(clientMsgId);
    if (existing) {
      const existingChannel = await this.channelsService.findById(
        existing.channelId,
      );
      const team9TenantId = existingChannel?.tenantId ?? binding.team9TenantId;
      return {
        team9MessageId: existing.id,
        team9ChannelId: existing.channelId,
        ...(team9TenantId ? { team9TenantId } : {}),
        status: 'duplicate',
      };
    }

    const attachments = this.mapExternalAttachments(message.attachments);
    const target = await this.resolveTeam9Target(binding);

    const result = await this.messagesService.sendFromExternalUser({
      userId: binding.team9UserId,
      channelId: target.channelId,
      content: message.content,
      attachments,
      workspaceId: target.tenantId,
      clientMsgId,
      metadata: {
        externalIm: {
          provider: message.provider,
          connectionId: binding.connectionId,
          team9UserId: binding.team9UserId,
          team9TenantId: target.tenantId,
          team9ChannelId: target.channelId,
          ...(target.botUserId ? { landingBotUserId: target.botUserId } : {}),
          idempotencyKey: message.idempotencyKey,
          externalTenantId: message.externalTenantId,
          externalConversationId: message.externalConversationId,
          externalMessageId: message.externalMessageId,
          externalThreadId: message.externalThreadId,
          sender: message.sender,
          occurredAt: message.occurredAt,
          raw: message.raw,
        },
      },
    });

    await this.websocketGateway.sendToChannelMembers(
      result.channelId,
      WS_EVENTS.MESSAGE.NEW,
      result.preview,
    );

    return {
      team9MessageId: result.messageId,
      team9ChannelId: result.channelId,
      team9TenantId: target.tenantId,
      status: 'persisted',
    };
  }

  private async resolveTeam9Target(
    binding: IngestExternalMessageDto['binding'],
  ): Promise<{ tenantId: string; channelId: string; botUserId?: string }> {
    const [user] = await this.db
      .select({
        id: schema.users.id,
        userType: schema.users.userType,
        isActive: schema.users.isActive,
      })
      .from(schema.users)
      .where(eq(schema.users.id, binding.team9UserId))
      .limit(1);

    if (!user) {
      throw new NotFoundException('Team9 user not found');
    }
    if (user.userType !== 'human') {
      throw new BadRequestException(
        'Weixin account must bind a human Team9 user',
      );
    }
    if (!user.isActive) {
      throw new ForbiddenException('Team9 user is inactive');
    }

    if (binding.team9ChannelId) {
      return this.resolveChannelReplyTarget(binding);
    }

    const tenantId = await this.resolveTenantId(
      binding.team9UserId,
      binding.team9TenantId,
    );
    const botUserId = await this.resolvePersonalAssistantBotUserId(
      binding.team9UserId,
      tenantId,
    );

    const channel = await this.channelsService.createDirectChannel(
      binding.team9UserId,
      botUserId,
      tenantId,
    );
    if (channel.isArchived || !channel.isActivated) {
      throw new ForbiddenException(
        'Team9 direct channel does not accept messages',
      );
    }

    return { tenantId, channelId: channel.id, botUserId };
  }

  private async resolvePersonalAssistantBotUserId(
    team9UserId: string,
    tenantId: string,
  ): Promise<string> {
    const [assistant] = await this.db
      .select({
        botUserId: schema.bots.userId,
      })
      .from(schema.installedApplications)
      .innerJoin(
        schema.bots,
        eq(schema.bots.installedApplicationId, schema.installedApplications.id),
      )
      .innerJoin(schema.users, eq(schema.users.id, schema.bots.userId))
      .where(
        and(
          eq(schema.installedApplications.tenantId, tenantId),
          eq(schema.installedApplications.applicationId, 'personal-staff'),
          eq(schema.installedApplications.isActive, true),
          eq(schema.installedApplications.status, 'active'),
          eq(schema.bots.ownerId, team9UserId),
          eq(schema.bots.isActive, true),
          eq(schema.users.userType, 'bot'),
          eq(schema.users.isActive, true),
        ),
      )
      .limit(1);

    if (!assistant) {
      throw new NotFoundException(
        'Team9 personal assistant not found for this user',
      );
    }
    if (!(await this.isActiveTenantMember(assistant.botUserId, tenantId))) {
      throw new ForbiddenException(
        'Team9 personal assistant is not a tenant member',
      );
    }

    return assistant.botUserId;
  }

  private async resolveChannelReplyTarget(
    binding: IngestExternalMessageDto['binding'],
  ): Promise<{ tenantId: string; channelId: string }> {
    if (!binding.team9ChannelId) {
      throw new BadRequestException('team9ChannelId is required');
    }

    const channel = await this.channelsService.findById(binding.team9ChannelId);
    if (!channel) {
      throw new NotFoundException('Team9 channel not found');
    }
    if (binding.team9TenantId && channel.tenantId) {
      if (binding.team9TenantId !== channel.tenantId) {
        throw new BadRequestException(
          'team9TenantId does not match Team9 channel',
        );
      }
    }

    const tenantId =
      channel.tenantId ??
      (await this.resolveTenantId(binding.team9UserId, binding.team9TenantId));

    if (
      channel.tenantId &&
      !(await this.isActiveTenantMember(binding.team9UserId, channel.tenantId))
    ) {
      throw new ForbiddenException('Team9 user is not a tenant member');
    }

    const isMember = await this.channelsService.isMember(
      channel.id,
      binding.team9UserId,
    );
    if (!isMember) {
      throw new ForbiddenException('Team9 user is not a channel member');
    }
    if (channel.isArchived || !channel.isActivated) {
      throw new ForbiddenException('Team9 channel does not accept messages');
    }

    return { tenantId, channelId: channel.id };
  }

  private async resolveTenantId(
    team9UserId: string,
    requestedTenantId: string | undefined,
  ): Promise<string> {
    if (requestedTenantId) {
      if (!(await this.isActiveTenantMember(team9UserId, requestedTenantId))) {
        throw new ForbiddenException('Team9 user is not a tenant member');
      }
      return requestedTenantId;
    }

    const memberships = await this.db
      .select({ tenantId: schema.tenantMembers.tenantId })
      .from(schema.tenantMembers)
      .where(
        and(
          eq(schema.tenantMembers.userId, team9UserId),
          isNull(schema.tenantMembers.leftAt),
        ),
      );

    if (memberships.length === 0) {
      throw new BadRequestException('Team9 user has no active tenant');
    }
    if (memberships.length > 1) {
      throw new BadRequestException(
        'team9TenantId is required when the Team9 user belongs to multiple tenants',
      );
    }
    return memberships[0].tenantId;
  }

  private async isActiveTenantMember(
    userId: string,
    tenantId: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: schema.tenantMembers.userId })
      .from(schema.tenantMembers)
      .where(
        and(
          eq(schema.tenantMembers.userId, userId),
          eq(schema.tenantMembers.tenantId, tenantId),
          isNull(schema.tenantMembers.leftAt),
        ),
      )
      .limit(1);

    return !!row;
  }

  private clientMsgIdFor(idempotencyKey: string): string {
    return `ext_${createHash('sha256')
      .update(idempotencyKey)
      .digest('hex')
      .slice(0, 60)}`;
  }

  private mapExternalAttachments(
    attachments: IngestExternalMessageDto['message']['attachments'],
  ): Array<{
    fileUrl: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
  }> {
    const unsupported = attachments.filter((attachment) => !attachment.url);
    if (unsupported.length > 0) {
      throw new BadRequestException(
        'External IM attachments without url are not supported yet',
      );
    }

    return attachments.map((attachment) => ({
      fileUrl: attachment.url!,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType ?? 'application/octet-stream',
      fileSize: attachment.fileSize ?? 0,
    }));
  }
}
