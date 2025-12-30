import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { WorkspaceService } from './workspace.service.js';
import { CreateInvitationDto } from './dto/index.js';
import { AuthGuard, CurrentUser } from '@team9/auth';

@Controller('v1/workspaces')
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Post(':workspaceId/invitations')
  @UseGuards(AuthGuard)
  async createInvitation(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.workspaceService.createInvitation(workspaceId, userId, dto);
  }

  @Get(':workspaceId/invitations')
  @UseGuards(AuthGuard)
  async getInvitations(@Param('workspaceId') workspaceId: string) {
    return this.workspaceService.getInvitations(workspaceId);
  }

  @Delete(':workspaceId/invitations/:code')
  @UseGuards(AuthGuard)
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
  @UseGuards(AuthGuard)
  async acceptInvitation(
    @Param('code') code: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.workspaceService.acceptInvitation(code, userId);
  }
}
