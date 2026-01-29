import { Module } from '@nestjs/common';
import { TaskController } from './task.controller.js';
import { TaskService } from './task.service.js';
import { SseService } from '../sse/sse.service.js';

@Module({
  controllers: [TaskController],
  providers: [TaskService, SseService],
  exports: [TaskService, SseService],
})
export class TaskModule {}
