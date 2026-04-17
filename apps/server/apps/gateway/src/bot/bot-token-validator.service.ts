import { Injectable } from '@nestjs/common';
import type { BotTokenValidatorInterface, JwtPayload } from '@team9/auth';
import { BotService } from './bot.service.js';

@Injectable()
export class BotTokenValidatorService implements BotTokenValidatorInterface {
  constructor(private readonly botService: BotService) {}

  async validateBotToken(rawToken: string): Promise<JwtPayload | null> {
    // Use the context variant so we carry tenantId through to AuthGuard.
    // Bot requests hit gateway.railway.internal and don't send X-Tenant-ID,
    // so TenantMiddleware leaves req.tenantId undefined — we must populate
    // it from the bot's installed application here.
    const context =
      await this.botService.validateAccessTokenWithContext(rawToken);
    if (!context) return null;

    return {
      sub: context.userId,
      email: context.email,
      username: context.username,
      tenantId: context.tenantId,
    };
  }
}
