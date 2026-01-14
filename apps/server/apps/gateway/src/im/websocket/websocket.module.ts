import { Module, forwardRef } from '@nestjs/common';
import { WebsocketGateway } from './websocket.gateway.js';
import { AuthModule } from '../../auth/auth.module.js';
import { UsersModule } from '../users/users.module.js';
import { ChannelsModule } from '../channels/channels.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { WorkspaceModule } from '../../workspace/workspace.module.js';
import { WEBSOCKET_GATEWAY } from '../../shared/constants/injection-tokens.js';
import { ImWorkerClientService } from '../services/im-worker-client.service.js';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => UsersModule),
    forwardRef(() => ChannelsModule),
    forwardRef(() => MessagesModule),
    forwardRef(() => WorkspaceModule),
  ],
  providers: [
    WebsocketGateway,
    ImWorkerClientService,
    {
      provide: WEBSOCKET_GATEWAY,
      useExisting: WebsocketGateway,
    },
  ],
  exports: [WebsocketGateway, WEBSOCKET_GATEWAY, ImWorkerClientService],
})
export class WebsocketModule {}
