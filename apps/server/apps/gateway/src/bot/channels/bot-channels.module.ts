import { Module } from '@nestjs/common';
import { BotChannelsController } from './bot-channels.controller.js';
import { ChannelsModule } from '../../im/channels/channels.module.js';
import { WebsocketModule } from '../../im/websocket/websocket.module.js';

/**
 * Houses the bot-facing channel endpoints separately from BotModule so that
 * the @Global BotModule does not need to import ChannelsModule /
 * WebsocketModule. Without this split, BotModule → ChannelsModule →
 * (useExisting BotService) → BotModule forms a resolution cycle that
 * deadlocks Nest at `registerRouter()` when the controller is mounted,
 * hanging gateway startup indefinitely.
 */
@Module({
  imports: [ChannelsModule, WebsocketModule],
  controllers: [BotChannelsController],
})
export class BotChannelsModule {}
