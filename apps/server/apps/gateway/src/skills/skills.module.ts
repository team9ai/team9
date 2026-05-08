import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WikisModule } from '../wikis/wikis.module.js';
import { SkillsController } from './skills.controller.js';
import { SkillsService } from './skills.service.js';

@Module({
  imports: [AuthModule, WikisModule],
  controllers: [SkillsController],
  providers: [SkillsService],
  exports: [SkillsService],
})
export class SkillsModule {}
