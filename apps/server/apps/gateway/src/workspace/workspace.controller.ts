import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { WorkspaceService } from './workspace.service';
import { CreateInvitationDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';

@Controller('v1/workspaces')
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Post(':workspaceId/invitations')
  @UseGuards(JwtAuthGuard)
  async createInvitation(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.workspaceService.createInvitation(workspaceId, userId, dto);
  }

  @Get(':workspaceId/invitations')
  @UseGuards(JwtAuthGuard)
  async getInvitations(@Param('workspaceId') workspaceId: string) {
    return this.workspaceService.getInvitations(workspaceId);
  }

  @Delete(':workspaceId/invitations/:code')
  @UseGuards(JwtAuthGuard)
  async revokeInvitation(
    @Param('workspaceId') workspaceId: string,
    @Param('code') code: string,
  ) {
    await this.workspaceService.revokeInvitation(workspaceId, code);
    return { message: 'Invitation revoked successfully' };
  }
}

@Controller('v1/invitations')
export class InvitationsController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get(':code/info')
  async getInvitationInfo(@Param('code') code: string) {
    return this.workspaceService.getInvitationInfo(code);
  }

  @Post(':code/accept')
  @UseGuards(JwtAuthGuard)
  async acceptInvitation(
    @Param('code') code: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.workspaceService.acceptInvitation(code, userId);
  }
}
