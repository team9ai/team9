import type { JwtPayload } from './jwt-payload.interface.js';

export const BOT_TOKEN_VALIDATOR = Symbol('BOT_TOKEN_VALIDATOR');

export interface BotTokenValidatorInterface {
  validateBotToken(rawToken: string): Promise<JwtPayload | null>;
}
