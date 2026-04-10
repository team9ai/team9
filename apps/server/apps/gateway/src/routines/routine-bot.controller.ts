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
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';
import { RoutineBotService } from './routine-bot.service.js';
import {
  CreateRoutineDto,
  UpdateRoutineDto,
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

  @Post()
  async create(
    @Body() dto: CreateRoutineDto,
    @CurrentUser('sub') botUserId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.routineBotService.createRoutine(dto, botUserId, tenantId);
  }

  @Get(':routineId')
  async getById(
    @Param('routineId', ParseUUIDPipe) routineId: string,
    @CurrentUser('sub') botUserId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.routineBotService.getRoutineById(routineId, botUserId, tenantId);
  }

  @Patch(':routineId')
  async update(
    @Param('routineId', ParseUUIDPipe) routineId: string,
    @Body() dto: UpdateRoutineDto,
    @CurrentUser('sub') botUserId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.routineBotService.updateRoutine(routineId, dto, botUserId, tenantId);
  }

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
