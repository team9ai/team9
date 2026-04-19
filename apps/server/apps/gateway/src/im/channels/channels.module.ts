import { Module, forwardRef } from '@nestjs/common';
import { ChannelsController } from './channels.controller.js';
import { ChannelsService, BOT_SERVICE_TOKEN } from './channels.service.js';
import { BotService } from '../../bot/bot.service.js';
import { AuthModule } from '../../auth/auth.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';
import { PropertiesModule } from '../properties/properties.module.js';
import { ViewsModule } from '../views/views.module.js';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => WebsocketModule),
    forwardRef(() => PropertiesModule),
    forwardRef(() => ViewsModule),
  ],
  controllers: [ChannelsController],
  providers: [
    ChannelsService,
    // Bridge the string token to the globally-exported BotService so that
    // ChannelsService can call getBotMentorId without a runtime circular ESM
    // import between channels.service.ts and bot.service.ts.
    {
      provide: BOT_SERVICE_TOKEN,
      useExisting: BotService,
    },
  ],
  exports: [ChannelsService],
})
export class ChannelsModule {}
