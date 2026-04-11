import { Module, forwardRef } from '@nestjs/common';
import { TabsService } from './tabs.service.js';
import { TabsController } from './tabs.controller.js';
import { ViewsService } from './views.service.js';
import { ViewsController } from './views.controller.js';
import { DatabaseModule } from '@team9/database';
import { WorkspaceModule } from '../../workspace/workspace.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';
import { PropertiesModule } from '../properties/properties.module.js';

@Module({
  imports: [
    DatabaseModule,
    WorkspaceModule,
    forwardRef(() => WebsocketModule),
    PropertiesModule,
  ],
  controllers: [TabsController, ViewsController],
  providers: [TabsService, ViewsService],
  exports: [TabsService, ViewsService],
})
export class ViewsModule {}
