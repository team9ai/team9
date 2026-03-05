import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';
import { TaskBotController } from './task-bot.controller.js';
import { TaskBotService } from './task-bot.service.js';
import { TaskCastService } from './taskcast.service.js';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [TasksController, TaskBotController],
  providers: [TasksService, TaskBotService, TaskCastService],
  exports: [TasksService, TaskCastService],
})
export class TasksModule {}
