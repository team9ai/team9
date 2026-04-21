import { Module, Global, forwardRef } from '@nestjs/common';
import { BOT_TOKEN_VALIDATOR } from '@team9/auth';
import { ClawHiveModule } from '@team9/claw-hive';
import { BotService } from './bot.service.js';
import { BotTokenValidatorService } from './bot-token-validator.service.js';
import { BotAuthCacheService } from './bot-auth-cache.service.js';
import { PlatformLlmService } from './platform-llm.service.js';
import { BotController } from './bot.controller.js';
import { ChannelsModule } from '../im/channels/channels.module.js';
import { BOT_SERVICE_TOKEN } from '../im/channels/channels.service.js';

/**
 * BotModule provides bot account management and token authentication.
 *
 * This module is global so BotService and BOT_TOKEN_VALIDATOR can be
 * injected anywhere — particularly in AuthGuard (for bot token auth)
 * and WorkspaceService (to add bots to new workspaces).
 *
 * Bot-facing REST endpoints that need ChannelsService / WebsocketGateway
 * live in BotChannelsModule to avoid pulling those imports into this
 * @Global module (doing so created a BotModule → ChannelsModule →
 * useExisting BotService → BotModule cycle that deadlocked Nest at
 * registerRouter()).
 *
 * BOT_SERVICE_TOKEN is provided here (instead of in ChannelsModule) so
 * that the token alias to BotService lives alongside the service
 * itself. ChannelsService resolves it lazily via ModuleRef, which
 * avoids a construction-time DI cycle (BotService.ctor depends on
 * ChannelsService, so ChannelsService cannot take BotService as a
 * constructor arg).
 */
@Global()
@Module({
  imports: [forwardRef(() => ChannelsModule), ClawHiveModule],
  controllers: [BotController],
  providers: [
    BotService,
    BotTokenValidatorService,
    BotAuthCacheService,
    PlatformLlmService,
    {
      provide: BOT_TOKEN_VALIDATOR,
      useExisting: BotTokenValidatorService,
    },
    {
      provide: BOT_SERVICE_TOKEN,
      useExisting: BotService,
    },
  ],
  exports: [
    BotService,
    BotAuthCacheService,
    PlatformLlmService,
    BOT_TOKEN_VALIDATOR,
    BOT_SERVICE_TOKEN,
  ],
})
export class BotModule {}
