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
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import type { ResourceType } from '@team9/database/schemas';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';
import { ResourcesService } from './resources.service.js';
import {
  CreateResourceDto,
  UpdateResourceDto,
  AuthorizeResourceDto,
  RevokeResourceDto,
} from './dto/index.js';

@Controller({
  path: 'resources',
  version: '1',
})
@UseGuards(AuthGuard)
export class ResourcesController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @Post()
  async create(
    @Body() dto: CreateResourceDto,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.resourcesService.create(dto, userId, tenantId);
  }

  @Get()
  async list(
    @CurrentTenantId() tenantId: string,
    @Query('type') type?: ResourceType,
  ) {
    return this.resourcesService.list(tenantId, { type });
  }

  @Get(':id')
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.resourcesService.getById(id, tenantId);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateResourceDto,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.resourcesService.update(id, dto, userId, tenantId);
  }

  @Delete(':id')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.resourcesService.delete(id, userId, tenantId);
  }

  // ── Authorization ──────────────────────────────────────────────

  @Post(':id/authorize')
  async authorize(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AuthorizeResourceDto,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.resourcesService.authorize(id, dto, userId, tenantId);
  }

  @Delete(':id/authorize')
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevokeResourceDto,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.resourcesService.revoke(id, dto, userId, tenantId);
  }

  // ── Usage Logs ─────────────────────────────────────────────────

  @Get(':id/usage-logs')
  async getUsageLogs(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.resourcesService.getUsageLogs(id, tenantId, limit, offset);
  }

  // ── Heartbeat ──────────────────────────────────────────────────

  @Post(':id/heartbeat')
  async heartbeat(@Param('id', ParseUUIDPipe) id: string) {
    return this.resourcesService.heartbeat(id);
  }
}
