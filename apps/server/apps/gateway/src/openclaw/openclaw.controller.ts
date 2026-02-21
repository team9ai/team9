import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OpenclawAuthGuard } from './openclaw-auth.guard.js';
import { OpenclawService } from './openclaw.service.js';

@Controller({ path: 'openclaw', version: '1' })
@UseGuards(OpenclawAuthGuard)
export class OpenclawController {
  constructor(private readonly openclawService: OpenclawService) {}

  @Get('search')
  async searchInstances(@Query('q') q: string) {
    return this.openclawService.searchInstances(q || '');
  }

  @Get('workspaces/:workspaceId/last-message')
  async getLastMessage(@Param('workspaceId') workspaceId: string) {
    return this.openclawService.getWorkspaceLastMessage(workspaceId);
  }

  @Post('workspaces/last-messages')
  async getLastMessages(@Body() body: { workspace_ids: string[] }) {
    return this.openclawService.getWorkspacesLastMessages(body.workspace_ids);
  }

  @Get('instance-activity')
  async getInstanceActivity() {
    return this.openclawService.getAllInstanceActivity();
  }
}
