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
import { CreateTaskDto, UpdateTaskDto } from './dto/index.js';

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
  async getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.tasksService.getById(id);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.tasksService.update(id, dto, userId);
  }

  @Delete(':id')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.tasksService.delete(id, userId);
  }

  @Get(':id/executions')
  async getExecutions(@Param('id', ParseUUIDPipe) id: string) {
    return this.tasksService.getExecutions(id);
  }

  @Get(':id/executions/:execId')
  async getExecution(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('execId', ParseUUIDPipe) execId: string,
  ) {
    return this.tasksService.getExecution(id, execId);
  }

  @Get(':id/deliverables')
  async getDeliverables(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('executionId') executionId?: string,
  ) {
    return this.tasksService.getDeliverables(id, executionId);
  }

  @Get(':id/interventions')
  async getInterventions(@Param('id', ParseUUIDPipe) id: string) {
    return this.tasksService.getInterventions(id);
  }
}
