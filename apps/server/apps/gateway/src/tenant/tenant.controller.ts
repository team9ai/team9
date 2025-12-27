import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { TenantService } from './tenant.service.js';
import {
  CreateTenantDto,
  UpdateTenantDto,
  AddMemberDto,
  UpdateMemberRoleDto,
} from './dto.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { TenantGuard } from './guards/tenant.guard.js';
import { TenantRoleGuard, TenantRoles } from './guards/tenant-role.guard.js';

@Controller({
  path: 'tenants',
  version: '1',
})
@UseGuards(AuthGuard)
export class TenantController {
  private readonly logger = new Logger(TenantController.name);

  constructor(private readonly tenantService: TenantService) {}

  @Post()
  async create(
    @Body() dto: CreateTenantDto,
    @CurrentUser() user: { sub: string },
  ) {
    this.logger.log(`Creating tenant: ${dto.name}`);
    return this.tenantService.create({
      ...dto,
      ownerId: user.sub,
    });
  }

  @Get('my')
  async getMyTenants(@CurrentUser() user: { sub: string }) {
    return this.tenantService.getUserTenants(user.sub);
  }

  @Get(':id')
  @UseGuards(TenantGuard)
  async findById(@Param('id') id: string) {
    return this.tenantService.findByIdOrThrow(id);
  }

  @Patch(':id')
  @UseGuards(TenantGuard, TenantRoleGuard)
  @TenantRoles('owner', 'admin')
  async update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    this.logger.log(`Updating tenant: ${id}`);
    return this.tenantService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(TenantGuard, TenantRoleGuard)
  @TenantRoles('owner')
  async delete(@Param('id') id: string) {
    this.logger.log(`Deleting tenant: ${id}`);
    await this.tenantService.delete(id);
    return { success: true };
  }

  // Member management
  @Get(':id/members')
  @UseGuards(TenantGuard)
  async getMembers(@Param('id') id: string) {
    return this.tenantService.getMembers(id);
  }

  @Post(':id/members')
  @UseGuards(TenantGuard, TenantRoleGuard)
  @TenantRoles('owner', 'admin')
  async addMember(
    @Param('id') id: string,
    @Body() dto: AddMemberDto,
    @CurrentUser() user: { sub: string },
  ) {
    this.logger.log(`Adding member ${dto.userId} to tenant ${id}`);
    await this.tenantService.addMember(id, dto.userId, dto.role, user.sub);
    return { success: true };
  }

  @Patch(':id/members/:userId/role')
  @UseGuards(TenantGuard, TenantRoleGuard)
  @TenantRoles('owner')
  async updateMemberRole(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    this.logger.log(`Updating role for ${userId} in tenant ${id}`);
    await this.tenantService.updateMemberRole(id, userId, dto.role);
    return { success: true };
  }

  @Delete(':id/members/:userId')
  @UseGuards(TenantGuard, TenantRoleGuard)
  @TenantRoles('owner', 'admin')
  async removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    this.logger.log(`Removing member ${userId} from tenant ${id}`);
    await this.tenantService.removeMember(id, userId);
    return { success: true };
  }
}
