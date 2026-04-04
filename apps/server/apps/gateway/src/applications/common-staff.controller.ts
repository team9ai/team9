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
  Header,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';
import { WorkspaceGuard } from '../workspace/guards/workspace.guard.js';
import { CommonStaffService } from './common-staff.service.js';
import {
  CreateCommonStaffDto,
  UpdateCommonStaffDto,
} from './dto/common-staff.dto.js';
import {
  GeneratePersonaDto,
  GenerateAvatarDto,
  GenerateCandidatesDto,
} from './dto/generate-persona.dto.js';

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

  /**
   * Stream an AI-generated persona for an AI staff member via SSE.
   *
   * Accepts optional context (displayName, roleTitle, existingPersona, prompt).
   * When existingPersona is provided the AI expands it rather than regenerating.
   * The user prompt is treated as highest-priority guidance.
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

    const stream = this.commonStaffService.generatePersona(
      appId,
      tenantId,
      dto,
    );
    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }

  /**
   * Generate a placeholder avatar URL for an AI staff member.
   *
   * Maps the requested style to a prompt template and combines it with staff
   * info context.  Returns a placeholder URL until a real image generation API
   * is integrated.
   */
  @Post('generate-avatar')
  async generateAvatar(
    @Param('id') appId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: GenerateAvatarDto,
  ) {
    return this.commonStaffService.generateAvatar(appId, tenantId, dto);
  }

  /**
   * Stream 3 AI employee candidate role cards via SSE.
   *
   * Each candidate event carries a structured JSON object with displayName,
   * roleTitle, persona, and summary fields.  Partial text chunks are emitted
   * as the AI streams its response.  The stream ends with a [DONE] sentinel.
   */
  @Post('generate-candidates')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  async generateCandidates(
    @Param('id') appId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: GenerateCandidatesDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const stream = this.commonStaffService.generateCandidates(
      appId,
      tenantId,
      dto,
    );
    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }
}
