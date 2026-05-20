import { Module } from '@nestjs/common';
import { ClawHiveModule } from '@team9/claw-hive';
import { AuthModule } from '../auth/auth.module.js';
import { MessagesModule } from '../im/messages/messages.module.js';
import { TaskCastService } from '../routines/taskcast.service.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [AuthModule, ClawHiveModule, MessagesModule],
  controllers: [TasksController],
  providers: [TasksService, TaskCastService],
  exports: [TasksService],
})
export class TasksModule {}
