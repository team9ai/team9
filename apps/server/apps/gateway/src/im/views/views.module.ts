import { Module, forwardRef } from '@nestjs/common';
import { TabsService } from './tabs.service.js';
import { TabsController } from './tabs.controller.js';
import { DatabaseModule } from '@team9/database';
import { WorkspaceModule } from '../../workspace/workspace.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';

@Module({
  imports: [DatabaseModule, WorkspaceModule, forwardRef(() => WebsocketModule)],
  controllers: [TabsController],
  providers: [TabsService],
  exports: [TabsService],
})
export class ViewsModule {}
