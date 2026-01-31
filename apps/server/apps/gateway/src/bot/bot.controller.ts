import {
  Controller,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { BotService } from './bot.service.js';
import { CreateBotDto, UpdateWebhookDto } from './dto/index.js';

@Controller({
  path: 'bots',
  version: '1',
})
@UseGuards(AuthGuard)
export class BotController {
  constructor(private readonly botService: BotService) {}

  /**
   * Create a new bot account.
   * Only human users can create bots.
   * If generateToken is true, the access token is returned (shown only once).
   */
  @Post()
  async createBot(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateBotDto,
  ) {
    const bot = await this.botService.createBot({
      username: dto.username,
      displayName: dto.displayName,
      type: dto.type ?? 'custom',
      ownerId: userId,
      description: dto.description,
      webhookUrl: dto.webhookUrl,
      capabilities: {
        canSendMessages: true,
        canReadMessages: true,
      },
    });

    let accessToken: string | undefined;
    if (dto.generateToken) {
      const tokenResult = await this.botService.generateAccessToken(bot.botId);
      accessToken = tokenResult.accessToken;
    }

    return { bot, accessToken };
  }

  /**
   * Regenerate a bot's access token.
   * The old token is immediately invalidated.
   * Only the bot owner can regenerate the token.
   */
  @Post(':botId/regenerate-token')
  async regenerateToken(
    @CurrentUser('sub') userId: string,
    @Param('botId') botId: string,
  ) {
    await this.assertBotOwner(botId, userId);
    const result = await this.botService.generateAccessToken(botId);
    return { accessToken: result.accessToken };
  }

  /**
   * Revoke a bot's access token.
   * Only the bot owner can revoke the token.
   */
  @Delete(':botId/revoke-token')
  async revokeToken(
    @CurrentUser('sub') userId: string,
    @Param('botId') botId: string,
  ) {
    await this.assertBotOwner(botId, userId);
    await this.botService.revokeAccessToken(botId);
    return { success: true };
  }

  /**
   * Update a bot's webhook URL.
   * Pass null to remove the webhook.
   * Only the bot owner can update the webhook.
   */
  @Patch(':botId/webhook')
  async updateWebhookUrl(
    @CurrentUser('sub') userId: string,
    @Param('botId') botId: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    await this.assertBotOwner(botId, userId);
    await this.botService.updateWebhook(
      botId,
      dto.webhookUrl ?? null,
      dto.webhookHeaders,
    );
    return { success: true };
  }

  /**
   * Verify the current user is the owner of the bot.
   */
  private async assertBotOwner(botId: string, userId: string): Promise<void> {
    const bot = await this.botService.getBotById(botId);
    if (!bot) {
      throw new NotFoundException('Bot not found');
    }
    if (bot.type === 'system') {
      throw new ForbiddenException('System bots cannot be managed via API');
    }
    if (bot.ownerId !== userId) {
      throw new ForbiddenException(
        'Only the bot owner can perform this action',
      );
    }
  }
}
