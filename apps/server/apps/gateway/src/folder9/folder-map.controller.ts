import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { BotAgentOwnership } from './bot-agent-ownership.service.js';
import { FolderMapRequestDto } from './dto/folder-map-request.dto.js';
import {
  FolderMapBuilder,
  type FolderMapResponse,
} from './folder-map-builder.service.js';

/**
 * `POST /api/v1/bot/folder-map` — per-session folderMap issuance for
 * `JustBashTeam9WorkspaceComponent` (agent-pi side).
 *
 * Auth: bearer-authenticated bot user (matches the pattern in
 * `/api/v1/bot/folder-token` and `/api/v1/bot/staff/profile`). The
 * controller also requires the `X-Team9-Bot-User-Id` header to match
 * the authenticated `sub` so a caller holding a legitimate bot token
 * cannot impersonate a different bot id on the wire.
 *
 * On 200 the response is a freshly resolved
 * `{ folderMap: { 'session.tmp': {...}, 'agent.home': {...}, ... } }`
 * built by {@link FolderMapBuilder.buildFolderMap}, which lazy-
 * provisions any missing `workspace_folder_mounts` rows + Folder9
 * folders along the way.
 *
 * Authorization beyond header-match is handled by
 * {@link BotAgentOwnership.assertAgentBelongsToBot}: the caller's bot
 * must manage the `dto.agentId` it is asking for. Mismatch → 403.
 */
@Controller({
  path: 'bot/folder-map',
  version: '1',
})
@UseGuards(AuthGuard)
export class FolderMapController {
  constructor(
    private readonly builder: FolderMapBuilder,
    private readonly ownership: BotAgentOwnership,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async build(
    @Body() dto: FolderMapRequestDto,
    @CurrentUser('sub') authenticatedUserId: string,
    @Headers('x-team9-bot-user-id') headerBotUserId: string | undefined,
  ): Promise<FolderMapResponse> {
    this.assertHeaderMatches(headerBotUserId, authenticatedUserId);
    await this.ownership.assertAgentBelongsToBot(
      authenticatedUserId,
      dto.agentId,
    );
    return this.builder.buildFolderMap({
      sessionId: dto.sessionId,
      agentId: dto.agentId,
      routineId: dto.routineId,
      userId: dto.userId,
    });
  }

  private assertHeaderMatches(header: string | undefined, sub: string): void {
    if (!header || header !== sub) {
      throw new ForbiddenException(
        'X-Team9-Bot-User-Id does not match authenticated bot',
      );
    }
  }
}
