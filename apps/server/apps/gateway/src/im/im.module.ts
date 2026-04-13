import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { ChannelsModule } from './channels/channels.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { WebsocketModule } from './websocket/websocket.module.js';
import { SyncModule } from './sync/sync.module.js';
import { SectionsModule } from './sections/sections.module.js';
import { AuditModule } from './audit/audit.module.js';
import { PropertiesModule } from './properties/properties.module.js';
import { ViewsModule } from './views/views.module.js';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    forwardRef(() => ChannelsModule),
    MessagesModule,
    WebsocketModule,
    SyncModule,
    SectionsModule,
    AuditModule,
    PropertiesModule,
    ViewsModule,
  ],
  exports: [
    AuthModule,
    UsersModule,
    forwardRef(() => ChannelsModule),
    MessagesModule,
    WebsocketModule,
    SyncModule,
    SectionsModule,
    AuditModule,
    PropertiesModule,
    ViewsModule,
  ],
})
export class ImModule {}
