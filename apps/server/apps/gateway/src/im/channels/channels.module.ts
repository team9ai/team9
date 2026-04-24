import { Module, forwardRef } from '@nestjs/common';
import { ChannelsController } from './channels.controller.js';
import { ChannelModelController } from './channel-model.controller.js';
import { ChannelsService } from './channels.service.js';
import { AuthModule } from '../../auth/auth.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';
import { PropertiesModule } from '../properties/properties.module.js';
import { ViewsModule } from '../views/views.module.js';
import { ClawHiveModule } from '@team9/claw-hive';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => WebsocketModule),
    forwardRef(() => PropertiesModule),
    forwardRef(() => ViewsModule),
    ClawHiveModule,
  ],
  controllers: [ChannelsController, ChannelModelController],
  providers: [ChannelsService],
  exports: [ChannelsService],
})
export class ChannelsModule {}
