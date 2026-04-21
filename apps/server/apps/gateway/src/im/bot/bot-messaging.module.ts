import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { ChannelsModule } from '../channels/channels.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { SearchModule } from '../../search/search.module.js';
import { BotMessagingController } from './bot-messaging.controller.js';

@Module({
  imports: [AuthModule, ChannelsModule, MessagesModule, SearchModule],
  controllers: [BotMessagingController],
})
export class BotMessagingModule {}
