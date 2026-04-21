import { Module, Global, forwardRef } from '@nestjs/common';
import { BOT_TOKEN_VALIDATOR } from '@team9/auth';
import { ClawHiveModule } from '@team9/claw-hive';
import { BotService } from './bot.service.js';
import { BotTokenValidatorService } from './bot-token-validator.service.js';
import { BotAuthCacheService } from './bot-auth-cache.service.js';
import { PlatformLlmService } from './platform-llm.service.js';
import { BotController } from './bot.controller.js';
import { BotChannelsController } from './channels/bot-channels.controller.js';
import { ChannelsModule } from '../im/channels/channels.module.js';
import { WebsocketModule } from '../im/websocket/websocket.module.js';

/**
 * BotModule provides bot account management and token authentication.
 *
 * This module is global so BotService and BOT_TOKEN_VALIDATOR can be
 * injected anywhere — particularly in AuthGuard (for bot token auth)
 * and WorkspaceService (to add bots to new workspaces).
 *
 * WebsocketModule is imported explicitly so BotChannelsController's
 * WebsocketGateway injection is declared in the module graph (NestJS
 * convention), even though it currently resolves transitively via
 * ChannelsModule → WebsocketModule.
 */
@Global()
@Module({
  imports: [
    forwardRef(() => ChannelsModule),
    forwardRef(() => WebsocketModule),
    ClawHiveModule,
  ],
  controllers: [BotController, BotChannelsController],
  providers: [
    BotService,
    BotTokenValidatorService,
    BotAuthCacheService,
    PlatformLlmService,
    {
      provide: BOT_TOKEN_VALIDATOR,
      useExisting: BotTokenValidatorService,
    },
  ],
  exports: [
    BotService,
    BotAuthCacheService,
    PlatformLlmService,
    BOT_TOKEN_VALIDATOR,
  ],
})
export class BotModule {}
