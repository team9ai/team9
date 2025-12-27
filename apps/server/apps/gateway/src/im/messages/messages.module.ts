import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';
import { AuthModule } from '../../auth/auth.module.js';
import { ChannelsModule } from '../channels/channels.module.js';

@Module({
  imports: [AuthModule, ChannelsModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
