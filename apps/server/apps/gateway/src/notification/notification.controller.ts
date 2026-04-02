import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import {
  NotificationService,
  NotificationResponse,
  NotificationCountsResponse,
} from './notification.service.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';
import { AuthGuard, CurrentUser } from '@team9/auth';
import {
  notificationTypeEnum,
  type NotificationType,
} from '@team9/database/schemas';
import { GetNotificationsQueryDto, MarkNotificationsDto } from './dto/index.js';

const VALID_NOTIFICATION_TYPES = new Set(notificationTypeEnum.enumValues);

function parseNotificationTypes(
  types: string | string[] | undefined,
): NotificationType[] | undefined {
  if (types === undefined) return undefined;
  if (Array.isArray(types)) {
    throw new BadRequestException('Invalid notification types');
  }
  if (typeof types !== 'string') {
    throw new BadRequestException('Invalid notification types');
  }

  const trimmed = types.trim();
  if (!trimmed) {
    throw new BadRequestException('Invalid notification types');
  }

  const parsed = trimmed.split(',').map((type) => type.trim());

  for (const type of parsed) {
    if (!type || !VALID_NOTIFICATION_TYPES.has(type as NotificationType)) {
      throw new BadRequestException('Invalid notification types');
    }
  }

  return parsed as NotificationType[];
}

@Controller({
  path: 'notifications',
  version: '1',
})
@UseGuards(AuthGuard)
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly deliveryService: NotificationDeliveryService,
  ) {}

  /**
   * GET /v1/notifications
   * Get user's notifications with pagination
   */
  @Get()
  async getNotifications(
    @CurrentUser('sub') userId: string,
    @Query() query: GetNotificationsQueryDto,
  ): Promise<{
    notifications: NotificationResponse[];
    nextCursor: string | null;
  }> {
    return this.notificationService.getNotifications(userId, {
      category: query.category,
      type: query.type,
      isRead: query.isRead,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  /**
   * GET /v1/notifications/counts
   * Get unread notification counts by category
   */
  @Get('counts')
  async getUnreadCounts(
    @CurrentUser('sub') userId: string,
  ): Promise<NotificationCountsResponse> {
    return this.notificationService.getUnreadCounts(userId);
  }

  /**
   * POST /v1/notifications/mark-read
   * Mark specific notifications as read
   */
  @Post('mark-read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(
    @CurrentUser('sub') userId: string,
    @Body() dto: MarkNotificationsDto,
  ): Promise<{ success: boolean }> {
    await this.notificationService.markAsRead(userId, dto.notificationIds);

    // Broadcast read event for multi-device sync
    await this.deliveryService.broadcastNotificationRead(
      userId,
      dto.notificationIds,
    );

    // Send updated counts
    const counts = await this.notificationService.getUnreadCounts(userId);
    await this.deliveryService.broadcastCountsUpdate(userId, counts);

    return { success: true };
  }

  /**
   * POST /v1/notifications/mark-all-read
   * Mark all notifications as read
   */
  @Post('mark-all-read')
  @HttpCode(HttpStatus.OK)
  async markAllAsRead(
    @CurrentUser('sub') userId: string,
    @Query('category') category?: string,
    @Query('types') types?: string | string[],
  ): Promise<{ success: boolean }> {
    const parsedTypes = parseNotificationTypes(types);

    await this.notificationService.markAllAsRead(userId, category, parsedTypes);

    await this.deliveryService.broadcastNotificationAllRead(
      userId,
      category,
      parsedTypes,
    );

    // Send updated counts
    const counts = await this.notificationService.getUnreadCounts(userId);
    await this.deliveryService.broadcastCountsUpdate(userId, counts);

    return { success: true };
  }

  /**
   * POST /v1/notifications/archive
   * Archive (dismiss) notifications
   */
  @Post('archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @CurrentUser('sub') userId: string,
    @Body() dto: MarkNotificationsDto,
  ): Promise<{ success: boolean }> {
    await this.notificationService.archive(userId, dto.notificationIds);

    // Send updated counts
    const counts = await this.notificationService.getUnreadCounts(userId);
    await this.deliveryService.broadcastCountsUpdate(userId, counts);

    return { success: true };
  }
}
