import {
  Injectable,
  ExecutionContext,
  Inject,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import {
  BOT_TOKEN_VALIDATOR,
  type BotTokenValidatorInterface,
} from '../interfaces/bot-token-validator.interface.js';
import type { JwtPayload } from '../interfaces/jwt-payload.interface.js';

type RequestWithUser = Request & {
  user?: JwtPayload;
  tenantId?: string;
};

@Injectable()
export class AuthGuard extends PassportAuthGuard('jwt') {
  constructor(
    @Optional()
    @Inject(BOT_TOKEN_VALIDATOR)
    private readonly botTokenValidator?: BotTokenValidatorInterface,
  ) {
    super();
  }

  private getAuthorizationHeader(request: Request): string | null {
    const headers = request.headers as Record<string, unknown>;
    const authorizationHeader = headers.authorization;

    if (typeof authorizationHeader === 'string') {
      return authorizationHeader;
    }

    if (
      Array.isArray(authorizationHeader) &&
      typeof authorizationHeader[0] === 'string'
    ) {
      return authorizationHeader[0];
    }

    return null;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = this.getAuthorizationHeader(request);

    // Bot tokens use the t9bot_ prefix — route to bot token validation
    if (authHeader?.startsWith('Bearer t9bot_')) {
      if (!this.botTokenValidator) {
        throw new UnauthorizedException('Bot authentication not available');
      }

      const rawToken = authHeader.slice(7); // strip 'Bearer '
      const payload = await this.botTokenValidator.validateBotToken(rawToken);
      if (!payload) {
        throw new UnauthorizedException('Invalid bot token');
      }

      request.user = payload;
      // Bot tokens carry their authoritative tenant from the bot's
      // installed application. We OVERRIDE any prior req.tenantId set by
      // TenantMiddleware — an attacker-controlled X-Tenant-ID header must
      // never re-scope a bot request into another tenant. For non-bot
      // (standard JWT) paths, tenant still flows via TenantMiddleware.
      if (payload.tenantId) {
        request.tenantId = payload.tenantId;
      }
      return true;
    }

    // Otherwise, use standard JWT validation via Passport
    return super.canActivate(context) as Promise<boolean>;
  }
}
