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
import {
  AgentTempTokenRequestDto,
  type AgentTempTokenResponse,
} from './dto/agent-temp-token-request.dto.js';
import { AgentTempTokenService } from './agent-temp-token.service.js';

@Controller({
  path: 'bot/agent-temp-token',
  version: '1',
})
@UseGuards(AuthGuard)
export class AgentTempTokenController {
  constructor(private readonly service: AgentTempTokenService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async issue(
    @Body() dto: AgentTempTokenRequestDto,
    @CurrentUser('sub') authenticatedUserId: string,
    @CurrentTenantId() tenantId: string | undefined,
    @Headers('x-team9-bot-user-id') headerBotUserId: string | undefined,
  ): Promise<AgentTempTokenResponse> {
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
