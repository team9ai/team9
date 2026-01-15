import { Module, forwardRef } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { AuthModule } from '../../auth/auth.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';
import { WorkspaceModule } from '../../workspace/workspace.module.js';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => WebsocketModule),
    forwardRef(() => WorkspaceModule),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
