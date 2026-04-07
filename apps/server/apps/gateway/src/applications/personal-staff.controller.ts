import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Header,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';
import { WorkspaceGuard } from '../workspace/guards/workspace.guard.js';
import { PersonalStaffService } from './personal-staff.service.js';
import {
  CreatePersonalStaffDto,
  UpdatePersonalStaffDto,
} from './dto/personal-staff.dto.js';
import {
  GeneratePersonaDto,
  GenerateAvatarDto,
} from './dto/generate-persona.dto.js';

@Controller({
  path: 'installed-applications/:id/personal-staff',
  version: '1',
})
@UseGuards(AuthGuard, WorkspaceGuard)
export class PersonalStaffController {
  constructor(private readonly personalStaffService: PersonalStaffService) {}

  /**
   * Get the current user's personal staff bot.
   * No botId needed — resolved via current user + workspace's installed app.
   */
  @Get('staff')
  async getStaff(
    @Param('id') appId: string,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.personalStaffService.getStaff(appId, tenantId, userId);
  }

  /**
   * Create a personal staff bot for the current user.
   * Enforces uniqueness: one per user per workspace.
   */
  @Post('staff')
  async createStaff(
    @Param('id') appId: string,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePersonalStaffDto,
  ) {
    return this.personalStaffService.createStaff(appId, tenantId, userId, dto);
  }

  /**
   * Update the current user's personal staff bot.
   * No botId needed — resolved via current user + workspace's installed app.
   */
  @Patch('staff')
  async updateStaff(
    @Param('id') appId: string,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdatePersonalStaffDto,
  ) {
    await this.personalStaffService.updateStaff(appId, tenantId, userId, dto);
  }

  /**
   * Delete the current user's personal staff bot.
   * No botId needed — resolved via current user + workspace's installed app.
   */
  @Delete('staff')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteStaff(
    @Param('id') appId: string,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('sub') userId: string,
  ) {
    await this.personalStaffService.deleteStaff(appId, tenantId, userId);
  }

  /**
   * Stream an AI-generated persona for a personal staff member via SSE.
   */
  @Post('generate-persona')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  async generatePersona(
    @Param('id') appId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: GeneratePersonaDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const stream = this.personalStaffService.generatePersona(
      appId,
      tenantId,
      dto,
    );
    try {
      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
    } catch (_error) {
      res.write(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
    } finally {
      res.end();
    }
  }

  /**
   * Generate a placeholder avatar URL for a personal staff member.
   */
  @Post('generate-avatar')
  async generateAvatar(
    @Param('id') appId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: GenerateAvatarDto,
  ) {
    return this.personalStaffService.generateAvatar(appId, tenantId, dto);
  }
}
