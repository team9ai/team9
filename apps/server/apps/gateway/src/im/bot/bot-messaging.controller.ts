import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { CurrentTenantId } from '../../common/decorators/current-tenant.decorator.js';
import { ChannelsService } from '../channels/channels.service.js';
import { MessagesService } from '../messages/messages.service.js';
import {
  SendToUserDto,
  type SendToUserResponse,
} from './dto/send-to-user.dto.js';

@Controller({ path: 'im/bot', version: '1' })
@UseGuards(AuthGuard)
export class BotMessagingController {
  constructor(
    private readonly channelsService: ChannelsService,
    private readonly messagesService: MessagesService,
  ) {}

  @Post('send-to-user')
  async sendToUser(
    @CurrentUser('sub') botUserId: string,
    @CurrentTenantId() tenantId: string | undefined,
    @Body() dto: SendToUserDto,
  ): Promise<SendToUserResponse> {
    // TODO(rate-limit): per-bot token bucket — owner-only default blocks the
    // biggest abuse surface for now; revisit in a follow-up spec.

    await this.channelsService.assertBotCanDm(botUserId, dto.userId);

    const channel = await this.channelsService.createDirectChannel(
      botUserId,
      dto.userId,
      tenantId,
    );

    const result = await this.messagesService.sendFromBot({
      botUserId,
      channelId: channel.id,
      content: dto.content,
      attachments: dto.attachments,
      workspaceId: tenantId ?? '',
    });

    return { channelId: result.channelId, messageId: result.messageId };

    // users/search added in Task 4
  }
}
