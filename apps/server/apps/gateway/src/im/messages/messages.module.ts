import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { AuthModule } from '../../auth/auth.module';
import { ChannelsModule } from '../channels/channels.module';

@Module({
  imports: [AuthModule, ChannelsModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
