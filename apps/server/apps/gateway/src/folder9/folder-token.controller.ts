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
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';
import { FolderTokenRequestDto } from './dto/folder-token-request.dto.js';
import {
  FolderTokenService,
  type FolderTokenResponse,
} from './folder-token.service.js';

/**
 * `POST /api/v1/bot/folder-token` — dynamic Folder9 token issuance
 * for `JustBashTeam9WorkspaceComponent` (agent-pi side).
 *
 * Auth: bearer-authenticated bot user (matches
 * `/api/v1/bot/staff/profile` pattern). The controller also requires
 * the `X-Team9-Bot-User-Id` header to match the authenticated `sub`
 * so callers that only hold a legitimate bot token but want to
 * impersonate a different bot id on the wire can't.
 *
 * The service layer {@link FolderTokenService.issueToken} handles
 * authz (tenant alignment, logicalKey scope) and Folder9-token
 * minting.
 */
@Controller({
  path: 'bot/folder-token',
  version: '1',
})
@UseGuards(AuthGuard)
export class FolderTokenController {
  constructor(private readonly service: FolderTokenService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async issue(
    @Body() dto: FolderTokenRequestDto,
    @CurrentUser('sub') authenticatedUserId: string,
    @CurrentTenantId() tenantId: string | undefined,
    @Headers('x-team9-bot-user-id') headerBotUserId: string | undefined,
  ): Promise<FolderTokenResponse> {
    this.assertHeaderMatches(headerBotUserId, authenticatedUserId);
    return this.service.issueToken(dto, authenticatedUserId, tenantId);
  }

  private assertHeaderMatches(header: string | undefined, sub: string): void {
    if (!header || header !== sub) {
      throw new ForbiddenException(
        'X-Team9-Bot-User-Id does not match authenticated bot',
      );
    }
  }
}
