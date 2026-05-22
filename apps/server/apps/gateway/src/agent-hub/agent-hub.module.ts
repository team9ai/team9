import { Module, forwardRef } from '@nestjs/common';
import { ClawHiveModule } from '@team9/claw-hive';
import { RedisModule } from '@team9/redis';
import { ApplicationsModule } from '../applications/applications.module.js';
import { ChannelsModule } from '../im/channels/channels.module.js';
import { AgentHubController } from './agent-hub.controller.js';
import { AgentHubService } from './agent-hub.service.js';

@Module({
  imports: [
    ApplicationsModule,
    forwardRef(() => ChannelsModule),
    ClawHiveModule,
    RedisModule,
  ],
  controllers: [AgentHubController],
  providers: [AgentHubService],
  exports: [AgentHubService],
})
export class AgentHubModule {}
