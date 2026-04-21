import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { CurrentTenantId } from '../../common/decorators/current-tenant.decorator.js';
import { ChannelsService } from '../channels/channels.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { SearchService } from '../../search/search.service.js';
import {
  SendToUserDto,
  type SendToUserResponse,
} from './dto/send-to-user.dto.js';
import {
  BotUserSearchDto,
  type BotUserSearchResponse,
} from './dto/bot-user-search.dto.js';

@Controller({ path: 'im/bot', version: '1' })
@UseGuards(AuthGuard)
export class BotMessagingController {
  constructor(
    private readonly channelsService: ChannelsService,
    private readonly messagesService: MessagesService,
    private readonly searchService: SearchService,
  ) {}

  @Post('send-to-user')
  async sendToUser(
    @CurrentUser('sub') botUserId: string,
    @CurrentTenantId() tenantId: string | undefined,
    @Body() dto: SendToUserDto,
  ): Promise<SendToUserResponse> {
    // TODO(rate-limit): per-bot token bucket — owner-only default blocks the
    // biggest abuse surface for now; revisit in a follow-up spec.

    // An authenticated bot request MUST carry a tenant context — the JWT is
    // always scoped to a tenant. Bail out early if the claim is absent so that
    // downstream logic never operates with an empty-string tenantId.
    if (!tenantId) {
      throw new BadRequestException('Bot token missing tenant context');
    }

    await this.channelsService.assertBotCanDm(botUserId, dto.userId, tenantId);

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
      workspaceId: tenantId,
    });

    return { channelId: result.channelId, messageId: result.messageId };
  }

  @Get('users/search')
  async searchUsers(
    @CurrentUser('sub') botUserId: string,
    @CurrentTenantId() tenantId: string | undefined,
    @Query() dto: BotUserSearchDto,
  ): Promise<BotUserSearchResponse> {
    if (!tenantId) {
      throw new BadRequestException('Bot token missing tenant context');
    }

    const raw = await this.searchService.searchUsers(
      dto.q,
      botUserId,
      tenantId,
      { limit: dto.limit ?? 5 },
    );

    // SearchResults<UserSearchResult> shape: { items: SearchResultItem<UserSearchResult>[], total, hasMore }
    // SearchResultItem<T> shape: { id, type, score, highlight?, data: T }
    // UserSearchResult shape: { id, username, displayName, email, status, isActive, createdAt }
    // Note: UserSearchResult has no avatarUrl field; omit it from the response.
    const items = raw.items ?? [];
    const mapped = items.map((entry) => {
      const row = entry.data;
      return {
        userId: row.id,
        displayName: row.displayName ?? row.username ?? '',
      };
    });

    // Exclude bot users
    const botIds = await this.channelsService.filterBotUserIds(
      mapped.map((r) => r.userId),
    );
    return { results: mapped.filter((r) => !botIds.has(r.userId)) };
  }
}
