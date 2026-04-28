import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { WebsocketModule } from '../im/websocket/websocket.module.js';
import { ChannelsModule } from '../im/channels/channels.module.js';
import { ClawHiveModule } from '@team9/claw-hive';
import { UsersModule } from '../im/users/users.module.js';
import { WikisModule } from '../wikis/wikis.module.js';
import { RoutinesController } from './routines.controller.js';
import { RoutinesService } from './routines.service.js';
import { RoutineBotController } from './routine-bot.controller.js';
import { RoutineBotService } from './routine-bot.service.js';
import { TaskCastService } from './taskcast.service.js';
import { RoutineTriggersService } from './routine-triggers.service.js';
import { RoutinesStreamController } from './routines-stream.controller.js';
import { RoutinesFolderIdNullSampler } from './metrics/routines-folder-id-null.sampler.js';

@Module({
  imports: [
    AuthModule,
    DocumentsModule,
    forwardRef(() => WebsocketModule),
    forwardRef(() => ChannelsModule),
    ClawHiveModule,
    forwardRef(() => UsersModule),
    // WikisModule re-exports `Folder9ClientService` so atomic create
    // (RoutinesService.create) and lazy provision (ensureRoutineFolder
    // callers in A.5/A.6) can share the same HTTP client.
    WikisModule,
  ],
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
    // Layer 2 monitoring (A.11). Periodic sampler that pushes
    // `routines.folder_id_null_total` to the OTEL pipeline; lifecycle
    // is owned by Nest via OnModuleInit/OnModuleDestroy.
    RoutinesFolderIdNullSampler,
  ],
  exports: [RoutinesService, TaskCastService, RoutineTriggersService],
})
export class RoutinesModule {}
