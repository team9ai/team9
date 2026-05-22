import { Module } from '@nestjs/common';
import { ClawHiveModule } from '@team9/claw-hive';
import { AuthModule } from '../auth/auth.module.js';
import { MessagesModule } from '../im/messages/messages.module.js';
import { WebsocketModule } from '../im/websocket/websocket.module.js';
import { ShortTitleGeneratorModule } from '../common/ai/short-title-generator.module.js';
import { TaskCastService } from '../routines/taskcast.service.js';
import { TaskTitleGeneratorService } from './task-title-generator.service.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [
    AuthModule,
    ClawHiveModule,
    MessagesModule,
    WebsocketModule,
    ShortTitleGeneratorModule,
  ],
  controllers: [TasksController],
  providers: [TasksService, TaskCastService, TaskTitleGeneratorService],
  exports: [TasksService],
})
export class TasksModule {}
