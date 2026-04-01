import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { BOT_TOKEN_PATTERN } from '../../bot/bot-token.util.js';

export class ValidateBotTokenDto {
  @IsString()
  @IsNotEmpty()
  @Matches(BOT_TOKEN_PATTERN)
  token!: string;
}
