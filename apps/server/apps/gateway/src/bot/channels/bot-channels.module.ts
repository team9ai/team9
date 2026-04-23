import { Module } from '@nestjs/common';
import { BotChannelsController } from './bot-channels.controller.js';
import { ChannelsModule } from '../../im/channels/channels.module.js';
import { WebsocketModule } from '../../im/websocket/websocket.module.js';

/**
 * Houses the bot-facing channel endpoints separately from BotModule so the
 * @Global BotModule does not mount BotChannelsController or import
 * WebsocketModule for these endpoints. (BotModule still imports
 * ChannelsModule, which is needed by BotService.) Without this split,
 * mounting the controller via BotModule — combined with the
 * `useExisting: BotService` provider that ChannelsService used to carry —
 * closed a resolution cycle that deadlocked Nest at `registerRouter()`
 * and hung gateway startup indefinitely. The ChannelsService side is
 * now broken via ModuleRef; this module split keeps the Websocket wiring
 * out of @Global BotModule on top of that.
 */
@Module({
  imports: [ChannelsModule, WebsocketModule],
  controllers: [BotChannelsController],
})
export class BotChannelsModule {}
