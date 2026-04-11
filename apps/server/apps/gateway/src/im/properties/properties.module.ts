import { Module, forwardRef } from '@nestjs/common';
import { PropertyDefinitionsService } from './property-definitions.service.js';
import { PropertyDefinitionsController } from './property-definitions.controller.js';
import { DatabaseModule } from '@team9/database';
import { WorkspaceModule } from '../../workspace/workspace.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';

@Module({
  imports: [DatabaseModule, WorkspaceModule, forwardRef(() => WebsocketModule)],
  controllers: [PropertyDefinitionsController],
  providers: [PropertyDefinitionsService],
  exports: [PropertyDefinitionsService],
})
export class PropertiesModule {}
