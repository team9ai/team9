import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from './users/users.module';
import { ChannelsModule } from './channels/channels.module';
import { MessagesModule } from './messages/messages.module';
import { WebsocketModule } from './websocket/websocket.module';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    ChannelsModule,
    MessagesModule,
    WebsocketModule,
  ],
  exports: [
    AuthModule,
    UsersModule,
    ChannelsModule,
    MessagesModule,
    WebsocketModule,
  ],
})
export class ImModule {}
