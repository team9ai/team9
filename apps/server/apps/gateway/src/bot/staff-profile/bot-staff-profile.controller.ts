import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { BotStaffProfileService } from './bot-staff-profile.service.js';
import { UpdateBotStaffProfileDto } from './bot-staff-profile.dto.js';

@Controller({
  path: 'bot/staff/profile',
  version: '1',
})
@UseGuards(AuthGuard)
export class BotStaffProfileController {
  constructor(private readonly service: BotStaffProfileService) {}

  @Get()
  async get(
    @CurrentUser('sub') authenticatedUserId: string,
    @Headers('x-team9-bot-user-id') headerBotUserId: string | undefined,
  ) {
    this.assertHeaderMatches(headerBotUserId, authenticatedUserId);
    return this.service.getSnapshot(authenticatedUserId);
  }

  @Patch()
  async patch(
    @CurrentUser('sub') authenticatedUserId: string,
    @Headers('x-team9-bot-user-id') headerBotUserId: string | undefined,
    @Body() dto: UpdateBotStaffProfileDto,
  ) {
    this.assertHeaderMatches(headerBotUserId, authenticatedUserId);
    return this.service.updateSnapshot(authenticatedUserId, {
      identityPatch: dto.identityPatch,
      role: dto.role,
      persona: dto.persona,
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
