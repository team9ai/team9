import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto.js';
import { AuthGuard } from '@team9/auth';
import {
  WorkspaceGuard,
  WorkspaceRoleGuard,
  WorkspaceRoles,
} from '../../workspace/guards/index.js';

@Controller({
  path: 'im',
  version: '1',
})
@UseGuards(AuthGuard, WorkspaceGuard, WorkspaceRoleGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('channels/:channelId/audit-logs')
  @WorkspaceRoles('member')
  async getAuditLogs(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Query() query: QueryAuditLogsDto,
  ) {
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
   */
  @Get('messages/:messageId/audit-logs')
  @WorkspaceRoles('member')
  async getMessageAuditLogs(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Query() query: QueryAuditLogsDto,
  ) {
    return this.auditService.findByEntity('message', messageId, {
      limit: query.limit,
      cursor: query.cursor,
    });
  }
}
