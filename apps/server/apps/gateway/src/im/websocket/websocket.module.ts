import { Module } from '@nestjs/common';
import { WebsocketGateway } from './websocket.gateway.js';
import { AuthModule } from '../../auth/auth.module.js';
import { UsersModule } from '../users/users.module.js';
import { ChannelsModule } from '../channels/channels.module.js';
import { MessagesModule } from '../messages/messages.module.js';

@Module({
  imports: [AuthModule, UsersModule, ChannelsModule, MessagesModule],
  providers: [WebsocketGateway],
  exports: [WebsocketGateway],
})
export class WebsocketModule {}
