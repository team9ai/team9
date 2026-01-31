import { Module, Global, forwardRef } from '@nestjs/common';
import { BOT_TOKEN_VALIDATOR } from '@team9/auth';
import { BotService } from './bot.service.js';
import { BotTokenValidatorService } from './bot-token-validator.service.js';
import { BotController } from './bot.controller.js';
import { ChannelsModule } from '../im/channels/channels.module.js';

/**
 * BotModule provides bot account management and token authentication.
 *
 * This module is global so BotService and BOT_TOKEN_VALIDATOR can be
 * injected anywhere — particularly in AuthGuard (for bot token auth)
 * and WorkspaceService (to add bots to new workspaces).
 */
@Global()
@Module({
  imports: [forwardRef(() => ChannelsModule)],
  controllers: [BotController],
  providers: [
    BotService,
    BotTokenValidatorService,
    {
      provide: BOT_TOKEN_VALIDATOR,
      useExisting: BotTokenValidatorService,
    },
  ],
  exports: [BotService, BOT_TOKEN_VALIDATOR],
})
export class BotModule {}
