import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import type { SkillType } from '@team9/database/schemas';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';
import { SkillsService } from './skills.service.js';
import { CreateSkillDto } from './dto/index.js';

@Controller({ path: 'bot/skills', version: '1' })
@UseGuards(AuthGuard)
export class BotSkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Get()
  async list(
    @CurrentUser('sub') authenticatedUserId: string,
    @Headers('x-team9-bot-user-id') headerBotUserId: string | undefined,
    @CurrentTenantId() tenantId: string,
    @Query('type') type?: SkillType,
    @Query('name') name?: string,
  ) {
    this.assertBot(headerBotUserId, authenticatedUserId);
    return this.skillsService.listForAgent(tenantId, { type, name });
  }

  @Get(':id')
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') authenticatedUserId: string,
    @Headers('x-team9-bot-user-id') headerBotUserId: string | undefined,
    @CurrentTenantId() tenantId: string,
  ) {
    this.assertBot(headerBotUserId, authenticatedUserId);
    return this.skillsService.getByIdForAgent(id, tenantId);
  }

  @Get(':id/folder/blob')
  async getFolderBlob(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') authenticatedUserId: string,
    @Headers('x-team9-bot-user-id') headerBotUserId: string | undefined,
    @CurrentTenantId() tenantId: string,
    @Query('path') path: string,
  ) {
    this.assertBot(headerBotUserId, authenticatedUserId);
    if (!path) throw new BadRequestException('path query parameter required');
    return this.skillsService.getFolderBlobForAgent(
      id,
      authenticatedUserId,
      tenantId,
      path,
    );
  }

  @Post()
  async create(
    @Body() dto: CreateSkillDto,
    @CurrentUser('sub') authenticatedUserId: string,
    @Headers('x-team9-bot-user-id') headerBotUserId: string | undefined,
    @CurrentTenantId() tenantId: string,
  ) {
    this.assertBot(headerBotUserId, authenticatedUserId);
    return this.skillsService.create(dto, authenticatedUserId, tenantId, {
      agentAccess: 'write',
    });
  }

  private assertBot(
    headerBotUserId: string | undefined,
    authUserId: string,
  ): void {
    if (!headerBotUserId || headerBotUserId !== authUserId) {
      throw new ForbiddenException(
        'x-team9-bot-user-id must equal authenticated bot user id',
      );
    }
  }
}
