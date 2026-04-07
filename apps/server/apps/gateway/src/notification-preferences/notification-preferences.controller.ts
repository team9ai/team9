import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import {
  NotificationPreferencesService,
  NotificationPreferencesResponse,
} from './notification-preferences.service.js';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto.js';
import { AuthGuard, CurrentUser } from '@team9/auth';

@Controller({
  path: 'notification-preferences',
  version: '1',
})
@UseGuards(AuthGuard)
export class NotificationPreferencesController {
  constructor(
    private readonly preferencesService: NotificationPreferencesService,
  ) {}

  /**
   * GET /v1/notification-preferences
   * Get the current user's notification preferences
   */
  @Get()
  async getPreferences(
    @CurrentUser('sub') userId: string,
  ): Promise<NotificationPreferencesResponse> {
    return this.preferencesService.getPreferences(userId);
  }

  /**
   * PATCH /v1/notification-preferences
   * Update the current user's notification preferences
   */
  @Patch()
  async updatePreferences(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesResponse> {
    return this.preferencesService.upsertPreferences(userId, dto);
  }
}
