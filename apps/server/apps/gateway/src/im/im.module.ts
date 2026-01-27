import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { ChannelsModule } from './channels/channels.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { WebsocketModule } from './websocket/websocket.module.js';
import { SyncModule } from './sync/sync.module.js';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    ChannelsModule,
    MessagesModule,
    WebsocketModule,
    SyncModule,
  ],
  exports: [
    AuthModule,
    UsersModule,
    ChannelsModule,
    MessagesModule,
    WebsocketModule,
    SyncModule,
  ],
})
export class ImModule {}
