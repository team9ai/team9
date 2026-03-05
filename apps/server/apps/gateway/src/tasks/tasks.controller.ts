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
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import type {
  AgentTaskStatus,
  AgentTaskScheduleType,
} from '@team9/database/schemas';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';
import { TasksService } from './tasks.service.js';
import {
  CreateTaskDto,
  UpdateTaskDto,
  StartTaskDto,
  ResumeTaskDto,
  StopTaskDto,
  ResolveInterventionDto,
} from './dto/index.js';

@Controller({
  path: 'tasks',
  version: '1',
})
@UseGuards(AuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  async create(
    @Body() dto: CreateTaskDto,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.tasksService.create(dto, userId, tenantId);
  }

  @Get()
  async list(
    @CurrentTenantId() tenantId: string,
    @Query('botId') botId?: string,
    @Query('status') status?: AgentTaskStatus,
    @Query('scheduleType') scheduleType?: AgentTaskScheduleType,
  ) {
    return this.tasksService.list(tenantId, { botId, status, scheduleType });
  }

  @Get(':id')
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.tasksService.getById(id, tenantId);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.tasksService.update(id, dto, userId, tenantId);
  }

  @Delete(':id')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.tasksService.delete(id, userId, tenantId);
  }

  @Get(':id/executions')
  async getExecutions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.tasksService.getExecutions(id, tenantId);
  }

  @Get(':id/executions/:execId')
  async getExecution(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('execId', ParseUUIDPipe) execId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.tasksService.getExecution(id, execId, tenantId);
  }

  @Get(':id/deliverables')
  async getDeliverables(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
    @Query('executionId') executionId?: string,
  ) {
    return this.tasksService.getDeliverables(id, executionId, tenantId);
  }

  @Get(':id/interventions')
  async getInterventions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.tasksService.getInterventions(id, tenantId);
  }

  // ── Task Control ──────────────────────────────────────────────

  @Post(':id/start')
  async start(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: StartTaskDto,
  ) {
    return this.tasksService.start(id, userId, tenantId, dto);
  }

  @Post(':id/pause')
  async pause(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.tasksService.pause(id, userId, tenantId);
  }

  @Post(':id/resume')
  async resume(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: ResumeTaskDto,
  ) {
    return this.tasksService.resume(id, userId, tenantId, dto);
  }

  @Post(':id/stop')
  async stop(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: StopTaskDto,
  ) {
    return this.tasksService.stop(id, userId, tenantId, dto);
  }

  @Post(':id/restart')
  async restart(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.tasksService.restart(id, userId, tenantId);
  }

  @Post(':id/interventions/:intId/resolve')
  async resolveIntervention(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('intId', ParseUUIDPipe) intId: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: ResolveInterventionDto,
  ) {
    return this.tasksService.resolveIntervention(
      id,
      intId,
      userId,
      tenantId,
      dto,
    );
  }
}
