import { Module, forwardRef } from '@nestjs/common';
import { ClawHiveModule } from '@team9/claw-hive';
import { AuthModule } from '../../auth/auth.module.js';
import { ChannelsModule } from '../channels/channels.module.js';
import { AgentSessionController } from './agent-session.controller.js';
import { AgentSessionBindingService } from './agent-session-binding.service.js';

@Module({
  imports: [AuthModule, forwardRef(() => ChannelsModule), ClawHiveModule],
  controllers: [AgentSessionController],
  providers: [AgentSessionBindingService],
  exports: [AgentSessionBindingService],
})
export class AgentSessionsModule {}
