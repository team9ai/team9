import {
  Controller,
  Get,
  Param,
  Query,
  Inject,
  UseGuards,
  ParseUUIDPipe,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto.js';
import { AuthGuard, CurrentUser } from '@team9/auth';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  isNull,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import {
  WorkspaceGuard,
  WorkspaceRoleGuard,
  WorkspaceRoles,
} from '../../workspace/guards/index.js';
import { ChannelsService } from '../channels/channels.service.js';

@Controller({
  path: 'im',
  version: '1',
})
@UseGuards(AuthGuard, WorkspaceGuard, WorkspaceRoleGuard)
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly channelsService: ChannelsService,
  ) {}

  @Get('channels/:channelId/audit-logs')
  @WorkspaceRoles('member')
  async getAuditLogs(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Query() query: QueryAuditLogsDto,
  ) {
    await this.channelsService.assertReadAccess(channelId, userId);
    return this.auditService.findByChannel(channelId, {
      limit: query.limit,
      cursor: query.cursor,
      entityType: query.entityType,
      action: query.action,
    });
  }

  /**
   * GET /v1/im/messages/:messageId/audit-logs
   * Returns audit entries for a specific message.
   * Verifies the requesting user is a member of the message's channel.
   */
  @Get('messages/:messageId/audit-logs')
  @WorkspaceRoles('member')
  async getMessageAuditLogs(
    @CurrentUser('sub') userId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Query() query: QueryAuditLogsDto,
  ) {
    // 1. Fetch the message to get its channelId
    const [message] = await this.db
      .select({ channelId: schema.messages.channelId })
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .limit(1);

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // 2. Verify the user is a member of that channel (active, not left)
    const [membership] = await this.db
      .select({ id: schema.channelMembers.id })
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, message.channelId),
          eq(schema.channelMembers.userId, userId),
          isNull(schema.channelMembers.leftAt),
        ),
      )
      .limit(1);

    if (!membership) {
      throw new ForbiddenException(
        'You must be a member of the channel to view message audit logs',
      );
    }

    return this.auditService.findByEntity('message', messageId, {
      limit: query.limit,
      cursor: query.cursor,
    });
  }
}
