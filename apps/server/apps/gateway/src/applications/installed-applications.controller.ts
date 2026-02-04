import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';
import { WorkspaceGuard } from '../workspace/guards/workspace.guard.js';
import {
  WorkspaceRoleGuard,
  WorkspaceRoles,
} from '../workspace/guards/workspace-role.guard.js';
import {
  InstalledApplicationsService,
  type InstallApplicationDto,
  type UpdateInstalledApplicationDto,
} from './installed-applications.service.js';
import { ApplicationsService } from './applications.service.js';

@Controller({
  path: 'installed-applications',
  version: '1',
})
@UseGuards(AuthGuard, WorkspaceGuard)
export class InstalledApplicationsController {
  constructor(
    private readonly installedApplicationsService: InstalledApplicationsService,
    private readonly applicationsService: ApplicationsService,
  ) {}

  /**
   * Get all installed applications for the current tenant.
   * Requires: workspace member
   */
  @Get()
  async findAll(@CurrentTenantId() tenantId: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    return this.installedApplicationsService.findAllByTenant(tenantId);
  }

  /**
   * Get an installed application by ID.
   * Requires: workspace member
   */
  @Get(':id')
  async findById(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    const app = await this.installedApplicationsService.findById(id, tenantId);
    if (!app) {
      throw new NotFoundException(`Installed application ${id} not found`);
    }
    return app;
  }

  /**
   * Install an application.
   * Requires: workspace admin or owner
   */
  @Post()
  @UseGuards(WorkspaceRoleGuard)
  @WorkspaceRoles('admin', 'owner')
  async install(
    @Body() dto: InstallApplicationDto,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Validate application exists
    const application = this.applicationsService.findById(dto.applicationId);
    if (!application) {
      throw new NotFoundException(`Application ${dto.applicationId} not found`);
    }

    return this.installedApplicationsService.install(tenantId, userId, {
      ...dto,
      name: dto.name || application.name,
      description: dto.description || application.description,
      iconUrl: dto.iconUrl || application.iconUrl,
    });
  }

  /**
   * Update an installed application.
   * Requires: workspace admin or owner
   */
  @Patch(':id')
  @UseGuards(WorkspaceRoleGuard)
  @WorkspaceRoles('admin', 'owner')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateInstalledApplicationDto,
    @CurrentTenantId() tenantId: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    return this.installedApplicationsService.update(id, tenantId, dto);
  }

  /**
   * Uninstall an application.
   * Requires: workspace admin or owner
   */
  @Delete(':id')
  @UseGuards(WorkspaceRoleGuard)
  @WorkspaceRoles('admin', 'owner')
  async uninstall(
    @Param('id') id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    await this.installedApplicationsService.uninstall(id, tenantId);
    return { success: true };
  }
}
