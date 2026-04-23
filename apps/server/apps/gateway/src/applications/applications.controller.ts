import {
  Controller,
  Get,
  Param,
  BadRequestException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@team9/auth';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';
import { WorkspaceGuard } from '../workspace/guards/workspace.guard.js';
import { ApplicationsService } from './applications.service.js';
import { InstalledApplicationsService } from './installed-applications.service.js';

@Controller({
  path: 'applications',
  version: '1',
})
@UseGuards(AuthGuard, WorkspaceGuard)
export class ApplicationsController {
  constructor(
    private readonly applicationsService: ApplicationsService,
    private readonly installedApplicationsService: InstalledApplicationsService,
  ) {}

  /**
   * Get all applications visible to the current tenant.
   * Hidden apps are filtered out unless the tenant has installed them.
   */
  @Get()
  async findAll(@CurrentTenantId() tenantId: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    const installed =
      await this.installedApplicationsService.findAllByTenant(tenantId);
    const installedIds = new Set(installed.map((a) => a.applicationId));
    return this.applicationsService.findAllVisible(installedIds);
  }

  /**
   * Get an application by ID. A hidden app returns 404 for tenants that have
   * not installed it, to avoid leaking the existence of soft-retired apps.
   */
  @Get(':id')
  async findById(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    const app = this.applicationsService.findById(id);
    if (!app) {
      throw new NotFoundException(`Application ${id} not found`);
    }
    if (app.hidden) {
      const installed =
        await this.installedApplicationsService.findByApplicationId(
          tenantId,
          id,
        );
      if (!installed) {
        throw new NotFoundException(`Application ${id} not found`);
      }
    }
    return app;
  }
}
