import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';
import { CreateTaskRunDto } from './dto/create-task-run.dto.js';
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
  async list(@CurrentTenantId() tenantId: string) {
    return this.tasksService.list(tenantId);
  }

  @Get(':runId')
  async getById(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.tasksService.getById(runId, tenantId);
  }

  @Get(':runId/deliverables')
  async getDeliverables(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.tasksService.getDeliverables(runId, tenantId);
  }
}
