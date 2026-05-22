import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';
import { WorkspaceGuard } from '../workspace/guards/workspace.guard.js';
import { AgentHubService } from './agent-hub.service.js';
import type { InstallRecommendedStaffDto } from './dto/install-recommended-staff.dto.js';

@Controller({ path: 'agent-hub', version: '1' })
@UseGuards(AuthGuard, WorkspaceGuard)
export class AgentHubController {
  constructor(private readonly agentHubService: AgentHubService) {}

  @Get('recommended-staff')
  async listRecommendedStaff(@CurrentTenantId() tenantId: string | undefined) {
    const workspaceId = this.requireTenantId(tenantId);
    return this.agentHubService.listRecommendedStaff(workspaceId);
  }

  @Post('recommended-staff/:templateId/install')
  async installRecommendedStaff(
    @Param('templateId') templateId: string,
    @CurrentTenantId() tenantId: string | undefined,
    @CurrentUser('sub') actorUserId: string,
    @Body() dto?: InstallRecommendedStaffDto,
  ) {
    const workspaceId = this.requireTenantId(tenantId);
    return this.agentHubService.installRecommendedStaff(
      workspaceId,
      actorUserId,
      templateId,
      dto ?? {},
    );
  }

  private requireTenantId(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    return tenantId;
  }
}
