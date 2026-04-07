import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { WebsocketModule } from '../im/websocket/websocket.module.js';
import { RoutinesController } from './routines.controller.js';
import { RoutinesService } from './routines.service.js';
import { RoutineBotController } from './routine-bot.controller.js';
import { RoutineBotService } from './routine-bot.service.js';
import { TaskCastService } from './taskcast.service.js';
import { RoutineTriggersService } from './routine-triggers.service.js';
import { RoutinesStreamController } from './routines-stream.controller.js';

@Module({
  imports: [AuthModule, DocumentsModule, forwardRef(() => WebsocketModule)],
  controllers: [
    RoutinesController,
    RoutineBotController,
    RoutinesStreamController,
  ],
  providers: [
    RoutinesService,
    RoutineBotService,
    TaskCastService,
    RoutineTriggersService,
  ],
  exports: [RoutinesService, TaskCastService, RoutineTriggersService],
})
export class RoutinesModule {}
