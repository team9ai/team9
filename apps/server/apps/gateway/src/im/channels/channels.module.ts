import { Module, forwardRef } from '@nestjs/common';
import { ChannelsController } from './channels.controller.js';
import { ChannelModelController } from './channel-model.controller.js';
import { ChannelsService } from './channels.service.js';
import { AuthModule } from '../../auth/auth.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';
import { PropertiesModule } from '../properties/properties.module.js';
import { ViewsModule } from '../views/views.module.js';
import { ClawHiveModule } from '@team9/claw-hive';
import { ModelChangeCommandService } from '../../model-policy/model-change-command.service.js';
import {
  ModelChangeOutboxProcessor,
  ModelChangeOutboxStore,
  PostgresModelChangeOutboxStore,
} from '../../model-policy/model-change-outbox.processor.js';
import { ModelChangeAttemptController } from '../../model-policy/model-change-attempt.controller.js';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => WebsocketModule),
    forwardRef(() => PropertiesModule),
    forwardRef(() => ViewsModule),
    ClawHiveModule,
  ],
  controllers: [
    ChannelsController,
    ChannelModelController,
    ModelChangeAttemptController,
  ],
  providers: [
    ChannelsService,
    ModelChangeCommandService,
    ModelChangeOutboxProcessor,
    {
      provide: ModelChangeOutboxStore,
      useClass: PostgresModelChangeOutboxStore,
    },
  ],
  exports: [ChannelsService, ModelChangeCommandService],
})
export class ChannelsModule {}
