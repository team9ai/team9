import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { WebsocketModule } from '../im/websocket/websocket.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';
import { TaskBotController } from './task-bot.controller.js';
import { TaskBotService } from './task-bot.service.js';
import { TaskCastService } from './taskcast.service.js';
import { TriggersService } from './triggers.service.js';
import { TasksStreamController } from './tasks-stream.controller.js';

@Module({
  imports: [AuthModule, DocumentsModule, forwardRef(() => WebsocketModule)],
  controllers: [TasksController, TaskBotController, TasksStreamController],
  providers: [TasksService, TaskBotService, TaskCastService, TriggersService],
  exports: [TasksService, TaskCastService, TriggersService],
})
export class TasksModule {}
