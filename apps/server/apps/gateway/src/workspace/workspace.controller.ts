import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { WorkspaceService } from './workspace.service.js';
import {
  CreateInvitationDto,
  GetMembersQueryDto,
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
  AddWorkspaceMemberDto,
  UpdateMemberRoleDto,
} from './dto/index.js';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { WorkspaceGuard } from './guards/workspace.guard.js';
import {
  WorkspaceRoleGuard,
  WorkspaceRoles,
} from './guards/workspace-role.guard.js';

@Controller({
  path: 'workspaces',
  version: '1',
})
export class WorkspaceController {
  private readonly logger = new Logger(WorkspaceController.name);

  constructor(private readonly workspaceService: WorkspaceService) {}

  // ===== Workspace CRUD =====

  @Post()
  @UseGuards(AuthGuard)
  async create(
    @Body() dto: CreateWorkspaceDto,
    @CurrentUser('sub') userId: string,
  ) {
    this.logger.log(`Creating workspace: ${dto.name}`);
    return this.workspaceService.create({
      ...dto,
      ownerId: userId,
    });
  }

  @Get()
  @UseGuards(AuthGuard)
  async getUserWorkspaces(@CurrentUser('sub') userId: string) {
    return this.workspaceService.getUserWorkspaces(userId);
  }

  @Get(':workspaceId')
  @UseGuards(AuthGuard, WorkspaceGuard)
  async findById(@Param('workspaceId') workspaceId: string) {
    return this.workspaceService.findByIdOrThrow(workspaceId);
  }

  @Patch(':workspaceId')
  @UseGuards(AuthGuard, WorkspaceGuard, WorkspaceRoleGuard)
  @WorkspaceRoles('owner', 'admin')
  async update(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    this.logger.log(`Updating workspace: ${workspaceId}`);
    return this.workspaceService.update(workspaceId, dto);
  }

  @Delete(':workspaceId')
  @UseGuards(AuthGuard, WorkspaceGuard, WorkspaceRoleGuard)
  @WorkspaceRoles('owner')
  async delete(@Param('workspaceId') workspaceId: string) {
    this.logger.log(`Deleting workspace: ${workspaceId}`);
    await this.workspaceService.delete(workspaceId);
    return { success: true };
  }

  // ===== Member Management =====

  @Get(':workspaceId/members')
  @UseGuards(AuthGuard)
  async getWorkspaceMembers(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser('sub') userId: string,
    @Query() query: GetMembersQueryDto,
  ) {
    return this.workspaceService.getWorkspaceMembers(workspaceId, userId, {
      page: query.page,
      limit: query.limit,
      search: query.search,
    });
  }

  @Post(':workspaceId/members')
  @UseGuards(AuthGuard, WorkspaceGuard, WorkspaceRoleGuard)
  @WorkspaceRoles('owner', 'admin')
  async addMember(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: AddWorkspaceMemberDto,
    @CurrentUser('sub') userId: string,
  ) {
    this.logger.log(`Adding member ${dto.userId} to workspace ${workspaceId}`);
    await this.workspaceService.addMember(
      workspaceId,
      dto.userId,
      dto.role,
      userId,
    );
    return { success: true };
  }

  @Patch(':workspaceId/members/:userId/role')
  @UseGuards(AuthGuard, WorkspaceGuard, WorkspaceRoleGuard)
  @WorkspaceRoles('owner')
  async updateMemberRole(
    @Param('workspaceId') workspaceId: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    this.logger.log(
      `Updating role for ${targetUserId} in workspace ${workspaceId}`,
    );
    await this.workspaceService.updateMemberRole(
      workspaceId,
      targetUserId,
      dto.role,
    );
    return { success: true };
  }

  @Delete(':workspaceId/members/:userId')
  @UseGuards(AuthGuard, WorkspaceGuard, WorkspaceRoleGuard)
  @WorkspaceRoles('owner', 'admin')
  async removeMember(
    @Param('workspaceId') workspaceId: string,
    @Param('userId') targetUserId: string,
  ) {
    this.logger.log(
      `Removing member ${targetUserId} from workspace ${workspaceId}`,
    );
    await this.workspaceService.removeMember(workspaceId, targetUserId);
    return { success: true };
  }

  @Get(':workspaceId/debug/online-status')
  @UseGuards(AuthGuard)
  async debugOnlineStatus(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.workspaceService.getOnlineOfflineMemberIds(workspaceId);
  }

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

@Controller({
  path: 'invitations',
  version: '1',
})
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
