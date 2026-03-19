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

  @Post(':taskId/executions/:executionId/steps')
  async reportSteps(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('executionId', ParseUUIDPipe) executionId: string,
    @Body() dto: ReportStepsDto,
    @CurrentUser('sub') botUserId: string,
  ) {
    return this.taskBotService.reportSteps(taskId, executionId, botUserId, dto);
  }

  @Patch(':taskId/executions/:executionId/status')
  async updateStatus(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('executionId', ParseUUIDPipe) executionId: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser('sub') botUserId: string,
  ) {
    return this.taskBotService.updateStatus(
      taskId,
      executionId,
      botUserId,
      dto.status,
      dto.error,
    );
  }

  @Post(':taskId/executions/:executionId/interventions')
  async createIntervention(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('executionId', ParseUUIDPipe) executionId: string,
    @Body() dto: CreateInterventionDto,
    @CurrentUser('sub') botUserId: string,
  ) {
    return this.taskBotService.createIntervention(
      taskId,
      executionId,
      botUserId,
      dto,
    );
  }

  @Post(':taskId/executions/:executionId/deliverables')
  async addDeliverable(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('executionId', ParseUUIDPipe) executionId: string,
    @Body() dto: AddDeliverableDto,
    @CurrentUser('sub') botUserId: string,
  ) {
    return this.taskBotService.addDeliverable(
      taskId,
      executionId,
      botUserId,
      dto,
    );
  }

  @Get(':taskId/executions/:executionId/document')
  async getDocument(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('executionId', ParseUUIDPipe) executionId: string,
    @CurrentUser('sub') botUserId: string,
  ) {
    return this.taskBotService.getTaskDocument(taskId, executionId, botUserId);
  }
}
