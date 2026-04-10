import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import type {
  RoutineStatus,
  RoutineScheduleType,
} from '@team9/database/schemas';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';
import { RoutinesService } from './routines.service.js';
import { RoutineTriggersService } from './routine-triggers.service.js';
import {
  CreateRoutineDto,
  UpdateRoutineDto,
  StartRoutineNewDto,
  ResumeRoutineDto,
  StopRoutineDto,
  ResolveInterventionDto,
  CreateTriggerDto,
  UpdateTriggerDto,
  RetryExecutionDto,
  RestartRoutineDto,
  CompleteCreationDto,
} from './dto/index.js';

@Controller({
  path: 'routines',
  version: '1',
})
@UseGuards(AuthGuard)
export class RoutinesController {
  constructor(
    private readonly routinesService: RoutinesService,
    private readonly routineTriggersService: RoutineTriggersService,
  ) {}

  @Post()
  async create(
    @Body() dto: CreateRoutineDto,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.routinesService.create(dto, userId, tenantId);
  }

  @Get()
  async list(
    @CurrentTenantId() tenantId: string,
    @CurrentUser('sub') userId: string,
    @Query('botId') botId?: string,
    @Query('status') status?: RoutineStatus,
    @Query('scheduleType') scheduleType?: RoutineScheduleType,
  ) {
    return this.routinesService.list(tenantId, { botId, status, scheduleType }, userId);
  }

  @Get(':id')
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.routinesService.getById(id, tenantId);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoutineDto,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.routinesService.update(id, dto, userId, tenantId);
  }

  @Delete(':id')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.routinesService.delete(id, userId, tenantId);
  }

  @Get(':id/executions')
  async getExecutions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.routinesService.getExecutions(id, tenantId);
  }

  @Get(':id/executions/:execId')
  async getExecution(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('execId', ParseUUIDPipe) execId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.routinesService.getExecution(id, execId, tenantId);
  }

  @Get(':id/executions/:execId/entries')
  async getExecutionEntries(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('execId', ParseUUIDPipe) execId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.routinesService.getExecutionEntries(id, execId, tenantId);
  }

  @Get(':id/deliverables')
  async getDeliverables(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
    @Query('executionId') executionId?: string,
  ) {
    return this.routinesService.getDeliverables(id, executionId, tenantId);
  }

  @Get(':id/interventions')
  async getInterventions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.routinesService.getInterventions(id, tenantId);
  }

  // ── Routine Control ──────────────────────────────────────────────

  @Post(':id/start')
  async start(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: StartRoutineNewDto,
  ) {
    return this.routinesService.start(id, userId, tenantId, dto);
  }

  @Post(':id/pause')
  async pause(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.routinesService.pause(id, userId, tenantId);
  }

  @Post(':id/resume')
  async resume(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: ResumeRoutineDto,
  ) {
    return this.routinesService.resume(id, userId, tenantId, dto);
  }

  @Post(':id/stop')
  async stop(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: StopRoutineDto,
  ) {
    return this.routinesService.stop(id, userId, tenantId, dto);
  }

  @Post(':id/restart')
  async restart(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: RestartRoutineDto,
  ) {
    return this.routinesService.restart(id, userId, tenantId, dto);
  }

  @Post(':id/interventions/:intId/resolve')
  async resolveIntervention(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('intId', ParseUUIDPipe) intId: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: ResolveInterventionDto,
  ) {
    return this.routinesService.resolveIntervention(
      id,
      intId,
      userId,
      tenantId,
      dto,
    );
  }

  // ── Creation Completion ──────────────────────────────────────────

  @Post(':id/complete-creation')
  @HttpCode(HttpStatus.OK)
  async completeCreation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteCreationDto,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.routinesService.completeCreation(id, dto, userId, tenantId);
  }

  // ── Trigger CRUD ──────────────────────────────────────────────

  @Post(':routineId/triggers')
  async createTrigger(
    @Param('routineId', ParseUUIDPipe) routineId: string,
    @Body() dto: CreateTriggerDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.routineTriggersService.create(routineId, dto, tenantId);
  }

  @Get(':routineId/triggers')
  async listTriggers(
    @Param('routineId', ParseUUIDPipe) routineId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.routineTriggersService.listByRoutine(routineId, tenantId);
  }

  @Patch(':routineId/triggers/:triggerId')
  async updateTrigger(
    @Param('routineId', ParseUUIDPipe) routineId: string,
    @Param('triggerId', ParseUUIDPipe) triggerId: string,
    @Body() dto: UpdateTriggerDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.routineTriggersService.update(triggerId, dto, tenantId);
  }

  @Delete(':routineId/triggers/:triggerId')
  async deleteTrigger(
    @Param('routineId', ParseUUIDPipe) routineId: string,
    @Param('triggerId', ParseUUIDPipe) triggerId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.routineTriggersService.delete(triggerId, tenantId);
  }

  // ── Retry ──────────────────────────────────────────────────────

  @Post(':id/retry')
  async retry(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: RetryExecutionDto,
  ) {
    return this.routinesService.retry(id, dto, userId, tenantId);
  }
}
