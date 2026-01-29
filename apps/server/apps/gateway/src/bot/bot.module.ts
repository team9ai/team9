import { Module, Global } from '@nestjs/common';
import { BotService } from './bot.service.js';

/**
 * BotModule provides the system bot account management.
 *
 * This module is global so BotService can be injected anywhere,
 * particularly in WorkspaceService to add the bot to new workspaces.
 */
@Global()
@Module({
  providers: [BotService],
  exports: [BotService],
})
export class BotModule {}
