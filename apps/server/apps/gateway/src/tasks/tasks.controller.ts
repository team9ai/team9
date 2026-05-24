import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';
import { CreateTaskRunDto } from './dto/create-task-run.dto.js';
import { UpdateTaskRunDto } from './dto/update-task-run.dto.js';
import { TasksService } from './tasks.service.js';

@Controller({
  path: 'tasks',
  version: '1',
})
@UseGuards(AuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  async create(
    @Body() dto: CreateTaskRunDto,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.tasksService.create(dto, userId, tenantId);
  }

  @Get()
  async list(
    @CurrentTenantId() tenantId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.tasksService.list(tenantId, userId);
  }

  @Get(':runId')
  async getById(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.tasksService.getById(runId, tenantId, userId);
  }

  @Patch(':runId')
  async update(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: UpdateTaskRunDto,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.tasksService.update(runId, dto, userId, tenantId);
  }

  @Post(':runId/hide')
  async hide(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.tasksService.hide(runId, userId, tenantId);
  }

  @Post(':runId/unhide')
  async unhide(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.tasksService.unhide(runId, userId, tenantId);
  }

  @Post(':runId/archive')
  async archive(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.tasksService.archive(runId, userId, tenantId);
  }

  @Post(':runId/activate')
  async activate(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.tasksService.activate(runId, userId, tenantId);
  }

  @Delete(':runId')
  async delete(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.tasksService.delete(runId, userId, tenantId);
  }

  @Post(':runId/start')
  async start(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: { message?: string },
  ) {
    return this.tasksService.start(runId, userId, tenantId, dto);
  }

  @Get(':runId/deliverables')
  async getDeliverables(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.tasksService.getDeliverables(runId, tenantId);
  }
}
