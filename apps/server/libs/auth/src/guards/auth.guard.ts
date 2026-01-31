import {
  Injectable,
  ExecutionContext,
  Inject,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import {
  BOT_TOKEN_VALIDATOR,
  type BotTokenValidatorInterface,
} from '../interfaces/bot-token-validator.interface.js';

@Injectable()
export class AuthGuard extends PassportAuthGuard('jwt') {
  constructor(
    @Optional()
    @Inject(BOT_TOKEN_VALIDATOR)
    private readonly botTokenValidator?: BotTokenValidatorInterface,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;

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
      return true;
    }

    // Otherwise, use standard JWT validation via Passport
    return super.canActivate(context) as Promise<boolean>;
  }
}
