import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WikisModule } from '../wikis/wikis.module.js';
import { SkillsController } from './skills.controller.js';
// TODO(task-4): import { BotSkillsController } from './bot-skills.controller.js';
import { SkillsService } from './skills.service.js';
import { SkillAgentAccessService } from './agent-access.service.js';

@Module({
  imports: [AuthModule, WikisModule],
  controllers: [
    SkillsController,
    // TODO(task-4): BotSkillsController,
  ],
  providers: [SkillsService, SkillAgentAccessService],
  exports: [SkillsService, SkillAgentAccessService],
})
export class SkillsModule {}
