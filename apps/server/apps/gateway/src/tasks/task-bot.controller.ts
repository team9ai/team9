import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { TaskBotService } from './task-bot.service.js';
import {
  ReportStepsDto,
  CreateInterventionDto,
  UpdateStatusDto,
  AddDeliverableDto,
} from './dto/index.js';

@Controller({
  path: 'bot/tasks',
  version: '1',
})
@UseGuards(AuthGuard)
export class TaskBotController {
  constructor(private readonly taskBotService: TaskBotService) {}

  @Post(':id/steps')
  async reportSteps(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportStepsDto,
    @CurrentUser('sub') botUserId: string,
  ) {
    return this.taskBotService.reportSteps(id, botUserId, dto);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser('sub') botUserId: string,
  ) {
    return this.taskBotService.updateStatus(
      id,
      botUserId,
      dto.status,
      dto.error,
    );
  }

  @Post(':id/interventions')
  async createIntervention(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInterventionDto,
    @CurrentUser('sub') botUserId: string,
  ) {
    return this.taskBotService.createIntervention(id, botUserId, dto);
  }

  @Post(':id/deliverables')
  async addDeliverable(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddDeliverableDto,
    @CurrentUser('sub') botUserId: string,
  ) {
    return this.taskBotService.addDeliverable(id, botUserId, dto);
  }

  @Get(':id/document')
  async getDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') botUserId: string,
  ) {
    return this.taskBotService.getTaskDocument(id, botUserId);
  }
}
