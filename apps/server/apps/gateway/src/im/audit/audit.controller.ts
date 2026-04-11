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
  path: 'im/channels/:channelId/audit-logs',
  version: '1',
})
@UseGuards(AuthGuard, WorkspaceGuard, WorkspaceRoleGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
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
}
