import { Module, forwardRef } from '@nestjs/common';
import { PropertyDefinitionsService } from './property-definitions.service.js';
import { PropertyDefinitionsController } from './property-definitions.controller.js';
import { MessagePropertiesService } from './message-properties.service.js';
import { MessagePropertiesController } from './message-properties.controller.js';
import { AiAutoFillService } from './ai-auto-fill.service.js';
import { MessageRelationsService } from './message-relations.service.js';
import { DatabaseModule } from '@team9/database';
import { WorkspaceModule } from '../../workspace/workspace.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ChannelsModule } from '../channels/channels.module.js';

@Module({
  imports: [
    DatabaseModule,
    WorkspaceModule,
    AuditModule,
    forwardRef(() => WebsocketModule),
    forwardRef(() => ChannelsModule),
  ],
  controllers: [PropertyDefinitionsController, MessagePropertiesController],
  providers: [
    PropertyDefinitionsService,
    MessagePropertiesService,
    AiAutoFillService,
    MessageRelationsService,
  ],
  exports: [
    PropertyDefinitionsService,
    MessagePropertiesService,
    AiAutoFillService,
    MessageRelationsService,
  ],
})
export class PropertiesModule {}
