import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { SectionsService, SectionResponse } from './sections.service.js';
import {
  CreateSectionDto,
  UpdateSectionDto,
  ReorderSectionsDto,
  MoveChannelDto,
} from './dto/index.js';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { CurrentTenantId } from '../../common/decorators/current-tenant.decorator.js';
import {
  WorkspaceGuard,
  WorkspaceRoleGuard,
  WorkspaceRoles,
} from '../../workspace/guards/index.js';

@Controller({
  path: 'im/sections',
  version: '1',
})
@UseGuards(AuthGuard, WorkspaceGuard, WorkspaceRoleGuard)
export class SectionsController {
  constructor(private readonly sectionsService: SectionsService) {}

  @Get()
  async getSections(
    @CurrentTenantId() tenantId: string | undefined,
  ): Promise<SectionResponse[]> {
    return this.sectionsService.getSections(tenantId);
  }

  @Get('with-channels')
  async getSectionsWithChannels(
    @CurrentTenantId() tenantId: string | undefined,
  ) {
    return this.sectionsService.getSectionsWithChannels(tenantId);
  }

  @Post()
  @WorkspaceRoles('member')
  async createSection(
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string | undefined,
    @Body() dto: CreateSectionDto,
  ): Promise<SectionResponse> {
    return this.sectionsService.create(dto, userId, tenantId);
  }

  @Get(':id')
  async getSection(
    @Param('id', ParseUUIDPipe) sectionId: string,
  ): Promise<SectionResponse> {
    return this.sectionsService.findByIdOrThrow(sectionId);
  }

  @Patch(':id')
  @WorkspaceRoles('member')
  async updateSection(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) sectionId: string,
    @Body() dto: UpdateSectionDto,
  ): Promise<SectionResponse> {
    return this.sectionsService.update(sectionId, dto, userId);
  }

  @Delete(':id')
  @WorkspaceRoles('member')
  async deleteSection(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) sectionId: string,
  ): Promise<{ success: boolean }> {
    await this.sectionsService.delete(sectionId, userId);
    return { success: true };
  }

  @Patch('reorder')
  @WorkspaceRoles('member')
  async reorderSections(
    @CurrentTenantId() tenantId: string | undefined,
    @Body() dto: ReorderSectionsDto,
  ): Promise<SectionResponse[]> {
    return this.sectionsService.reorderSections(dto.sectionIds, tenantId);
  }
}

@Controller({
  path: 'im/channels',
  version: '1',
})
@UseGuards(AuthGuard, WorkspaceGuard, WorkspaceRoleGuard)
export class ChannelSectionController {
  constructor(private readonly sectionsService: SectionsService) {}

  @Patch(':id/move')
  @WorkspaceRoles('member')
  async moveChannel(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) channelId: string,
    @Body() dto: MoveChannelDto,
  ): Promise<{ success: boolean }> {
    await this.sectionsService.moveChannelToSection(
      channelId,
      dto.sectionId ?? null,
      dto.order,
      userId,
    );
    return { success: true };
  }
}
