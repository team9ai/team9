import { Injectable } from '@nestjs/common';
import type { BotTokenValidatorInterface, JwtPayload } from '@team9/auth';
import { BotService } from './bot.service.js';

@Injectable()
export class BotTokenValidatorService implements BotTokenValidatorInterface {
  constructor(private readonly botService: BotService) {}

  async validateBotToken(rawToken: string): Promise<JwtPayload | null> {
    const result = await this.botService.validateAccessToken(rawToken);
    if (!result) return null;

    return {
      sub: result.userId,
      email: result.email,
      username: result.username,
    };
  }
}
