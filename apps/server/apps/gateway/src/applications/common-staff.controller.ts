import {
  Controller,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';
import { WorkspaceGuard } from '../workspace/guards/workspace.guard.js';
import { CommonStaffService } from './common-staff.service.js';
import {
  CreateCommonStaffDto,
  UpdateCommonStaffDto,
} from './dto/common-staff.dto.js';

@Controller({
  path: 'installed-applications/:id/common-staff',
  version: '1',
})
@UseGuards(AuthGuard, WorkspaceGuard)
export class CommonStaffController {
  constructor(private readonly commonStaffService: CommonStaffService) {}

  /**
   * Create a new common-staff bot for this installed application.
   * Any authenticated workspace member can create a staff member.
   */
  @Post('staff')
  async createStaff(
    @Param('id') appId: string,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateCommonStaffDto,
  ) {
    return this.commonStaffService.createStaff(appId, tenantId, userId, dto);
  }

  /**
   * Update an existing common-staff bot.
   */
  @Patch('staff/:botId')
  async updateStaff(
    @Param('id') appId: string,
    @Param('botId') botId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: UpdateCommonStaffDto,
  ) {
    await this.commonStaffService.updateStaff(appId, tenantId, botId, dto);
  }

  /**
   * Delete a common-staff bot.
   */
  @Delete('staff/:botId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteStaff(
    @Param('id') appId: string,
    @Param('botId') botId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    await this.commonStaffService.deleteStaff(appId, tenantId, botId);
  }
}
