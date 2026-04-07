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
import { RoutineBotService } from './routine-bot.service.js';
import {
  ReportStepsDto,
  CreateInterventionDto,
  UpdateStatusDto,
  AddDeliverableDto,
} from './dto/index.js';

@Controller({
  path: 'bot/routines',
  version: '1',
})
@UseGuards(AuthGuard)
export class RoutineBotController {
  constructor(private readonly routineBotService: RoutineBotService) {}

  @Post(':routineId/executions/:executionId/steps')
  async reportSteps(
    @Param('routineId', ParseUUIDPipe) routineId: string,
    @Param('executionId', ParseUUIDPipe) executionId: string,
    @Body() dto: ReportStepsDto,
    @CurrentUser('sub') botUserId: string,
  ) {
    return this.routineBotService.reportSteps(
      routineId,
      executionId,
      botUserId,
      dto,
    );
  }

  @Patch(':routineId/executions/:executionId/status')
  async updateStatus(
    @Param('routineId', ParseUUIDPipe) routineId: string,
    @Param('executionId', ParseUUIDPipe) executionId: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser('sub') botUserId: string,
  ) {
    return this.routineBotService.updateStatus(
      routineId,
      executionId,
      botUserId,
      dto.status,
      dto.error,
    );
  }

  @Post(':routineId/executions/:executionId/interventions')
  async createIntervention(
    @Param('routineId', ParseUUIDPipe) routineId: string,
    @Param('executionId', ParseUUIDPipe) executionId: string,
    @Body() dto: CreateInterventionDto,
    @CurrentUser('sub') botUserId: string,
  ) {
    return this.routineBotService.createIntervention(
      routineId,
      executionId,
      botUserId,
      dto,
    );
  }

  @Post(':routineId/executions/:executionId/deliverables')
  async addDeliverable(
    @Param('routineId', ParseUUIDPipe) routineId: string,
    @Param('executionId', ParseUUIDPipe) executionId: string,
    @Body() dto: AddDeliverableDto,
    @CurrentUser('sub') botUserId: string,
  ) {
    return this.routineBotService.addDeliverable(
      routineId,
      executionId,
      botUserId,
      dto,
    );
  }

  @Get(':routineId/executions/:executionId/document')
  async getDocument(
    @Param('routineId', ParseUUIDPipe) routineId: string,
    @Param('executionId', ParseUUIDPipe) executionId: string,
    @CurrentUser('sub') botUserId: string,
  ) {
    return this.routineBotService.getRoutineDocument(
      routineId,
      executionId,
      botUserId,
    );
  }
}
