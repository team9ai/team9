import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { WorkspaceGuard } from './guards/workspace.guard.js';
import { OnboardingService } from './onboarding.service.js';
import {
  CompleteWorkspaceOnboardingDto,
  GenerateWorkspaceOnboardingDto,
  UpdateWorkspaceOnboardingDto,
} from './dto/index.js';

@Controller({
  path: 'onboarding',
  version: '1',
})
@UseGuards(AuthGuard)
export class OnboardingCatalogController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get('roles')
  async listRoles(
    @Query('lang') lang?: string,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    return this.onboardingService.listRoles(lang, acceptLanguage);
  }
}

@Controller({
  path: 'workspaces/:workspaceId/onboarding',
  version: '1',
})
@UseGuards(AuthGuard, WorkspaceGuard)
export class WorkspaceOnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get()
  async getState(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.onboardingService.getState(workspaceId, userId);
  }

  @Patch()
  async updateState(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateWorkspaceOnboardingDto,
  ) {
    return this.onboardingService.updateState(workspaceId, userId, dto);
  }

  @Post('generate-tasks')
  async generateTasks(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: GenerateWorkspaceOnboardingDto,
  ) {
    return this.onboardingService.generateTasks(workspaceId, userId, dto);
  }

  @Post('generate-channels')
  async generateChannels(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: GenerateWorkspaceOnboardingDto,
  ) {
    return this.onboardingService.generateChannels(workspaceId, userId, dto);
  }

  @Post('generate-agents')
  async generateAgents(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: GenerateWorkspaceOnboardingDto,
  ) {
    return this.onboardingService.generateAgents(workspaceId, userId, dto);
  }

  @Post('complete')
  async complete(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CompleteWorkspaceOnboardingDto,
  ) {
    return this.onboardingService.complete(workspaceId, userId, dto);
  }
}
