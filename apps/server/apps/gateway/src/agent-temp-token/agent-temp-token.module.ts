import { Module } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { AuthModule } from '../auth/auth.module.js';
import { AgentTempTokenController } from './agent-temp-token.controller.js';
import { AgentTempTokenService } from './agent-temp-token.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [AgentTempTokenController],
  providers: [AgentTempTokenService],
  exports: [AgentTempTokenService],
})
export class AgentTempTokenModule {}
