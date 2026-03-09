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
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import type { SkillType } from '@team9/database/schemas';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';
import { SkillsService } from './skills.service.js';
import {
  CreateSkillDto,
  UpdateSkillDto,
  CreateVersionDto,
  ReviewVersionDto,
} from './dto/index.js';

@Controller({
  path: 'skills',
  version: '1',
})
@UseGuards(AuthGuard)
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Post()
  async create(
    @Body() dto: CreateSkillDto,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.skillsService.create(dto, userId, tenantId);
  }

  @Get()
  async list(
    @CurrentTenantId() tenantId: string,
    @Query('type') type?: SkillType,
  ) {
    return this.skillsService.list(tenantId, type);
  }

  @Get(':id')
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.skillsService.getById(id, tenantId);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSkillDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.skillsService.update(id, dto, tenantId);
  }

  @Delete(':id')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.skillsService.delete(id, tenantId);
  }

  @Get(':id/versions')
  async listVersions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.skillsService.listVersions(id, tenantId);
  }

  @Get(':id/versions/:version')
  async getVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.skillsService.getVersion(id, version, tenantId);
  }

  @Post(':id/versions')
  async createVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVersionDto,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.skillsService.createVersion(id, dto, userId, tenantId);
  }

  @Patch(':id/versions/:version')
  async reviewVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() dto: ReviewVersionDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.skillsService.reviewVersion(id, version, dto.action, tenantId);
  }
}
