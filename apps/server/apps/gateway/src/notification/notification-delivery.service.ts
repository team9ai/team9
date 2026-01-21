import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@team9/redis';
import { REDIS_KEYS } from '../im/shared/constants/redis-keys.js';

// Forward reference to avoid circular dependency
export const WEBSOCKET_GATEWAY_TOKEN = 'WEBSOCKET_GATEWAY';

export interface NotificationPayload {
  id?: string;
  category: string;
  type: string;
  priority?: string;
  title: string;
  body?: string | null;
  actor?: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
  tenantId?: string | null;
  channelId?: string | null;
  messageId?: string | null;
  actionUrl?: string | null;
  createdAt?: Date | string;
}

export interface NotificationCountsPayload {
  total: number;
  byCategory: {
    message: number;
    system: number;
    workspace: number;
  };
}

// WebSocket events for notifications
export const WS_NOTIFICATION_EVENTS = {
  NEW: 'notification_new',
  COUNTS_UPDATED: 'notification_counts_updated',
  READ: 'notification_read',
} as const;

@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);
  private websocketGateway: any = null;

  constructor(private readonly redisService: RedisService) {}

  /**
   * Set the WebSocket gateway instance (called from module initialization)
   * This avoids circular dependency issues
   */
  setWebsocketGateway(gateway: any): void {
    this.websocketGateway = gateway;
    this.logger.log('WebSocket gateway set for notification delivery');
  }

  /**
   * Deliver notification to a user
   * Uses WebSocket for online users
   */
  async deliverToUser(
    userId: string,
    notification: NotificationPayload,
  ): Promise<void> {
    if (!this.websocketGateway) {
      this.logger.warn('WebSocket gateway not initialized, skipping delivery');
      return;
    }

    const isOnline = await this.isUserOnline(userId);

    if (isOnline) {
      // Send via WebSocket
      await this.websocketGateway.sendToUser(
        userId,
        WS_NOTIFICATION_EVENTS.NEW,
        notification,
      );
    } else {
      // For offline users, the notification is already persisted in the database
      // They will fetch it when they come online
      this.logger.debug(
        `User ${userId} is offline, notification persisted for later`,
      );
    }
  }

  /**
   * Deliver notification to multiple users
   */
  async deliverToUsers(
    userIds: string[],
    notification: NotificationPayload,
  ): Promise<void> {
    for (const userId of userIds) {
      await this.deliverToUser(userId, notification);
    }
  }

  /**
   * Broadcast notification counts update to a user
   */
  async broadcastCountsUpdate(
    userId: string,
    counts: NotificationCountsPayload,
  ): Promise<void> {
    if (!this.websocketGateway) {
      return;
    }

    const isOnline = await this.isUserOnline(userId);

    if (isOnline) {
      await this.websocketGateway.sendToUser(
        userId,
        WS_NOTIFICATION_EVENTS.COUNTS_UPDATED,
        counts,
      );
      this.logger.debug(`Sent counts update to user ${userId}`);
    }
  }

  /**
   * Broadcast notification read event (for multi-device sync)
   */
  async broadcastNotificationRead(
    userId: string,
    notificationIds: string[],
  ): Promise<void> {
    if (!this.websocketGateway) {
      return;
    }

    const isOnline = await this.isUserOnline(userId);

    if (isOnline) {
      await this.websocketGateway.sendToUser(
        userId,
        WS_NOTIFICATION_EVENTS.READ,
        { notificationIds },
      );
      this.logger.debug(`Sent notification read event to user ${userId}`);
    }
  }

  /**
   * Check if user is online
   */
  private async isUserOnline(userId: string): Promise<boolean> {
    const socketIds = await this.redisService.smembers(
      REDIS_KEYS.USER_SOCKETS(userId),
    );
    return socketIds.length > 0;
  }
}
