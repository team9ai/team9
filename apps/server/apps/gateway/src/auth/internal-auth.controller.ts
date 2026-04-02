import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { BotService } from '../bot/bot.service.js';
import { ValidateBotTokenDto } from './dto/index.js';
import { InternalAuthGuard } from './internal-auth.guard.js';

type ValidateBotTokenSuccessResponse = {
  valid: true;
  botId: string;
  userId: string;
  tenantId: string;
};

@Controller({
  path: 'internal/auth',
  version: '1',
})
@UseGuards(InternalAuthGuard)
export class InternalAuthController {
  constructor(private readonly botService: BotService) {}

  @Post('validate-bot-token')
  @HttpCode(HttpStatus.OK)
  async validateBotToken(
    @Body() dto: ValidateBotTokenDto,
  ): Promise<ValidateBotTokenSuccessResponse> {
    const context = await this.botService.validateAccessTokenWithContext(
      dto.token,
    );

    if (!context) {
      throw new NotFoundException({
        valid: false,
        error: 'invalid token',
      });
    }

    return {
      valid: true,
      botId: context.botId,
      userId: context.userId,
      tenantId: context.tenantId,
    };
  }
}
