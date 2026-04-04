import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@team9/redis';
import type { NotificationType } from '@team9/database/schemas';
import { REDIS_KEYS } from '../im/shared/constants/redis-keys.js';
import { WebPushService } from './web-push.service.js';
import { NotificationPreferencesService } from '../notification-preferences/notification-preferences.service.js';

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
  byType: {
    mention: number;
    channel_mention: number;
    everyone_mention: number;
    here_mention: number;
    reply: number;
    thread_reply: number;
    dm_received: number;
    system_announcement: number;
    maintenance_notice: number;
    version_update: number;
    workspace_invitation: number;
    role_changed: number;
    member_joined: number;
    member_left: number;
    channel_invite: number;
  };
}

// WebSocket events for notifications
export const WS_NOTIFICATION_EVENTS = {
  NEW: 'notification_new',
  COUNTS_UPDATED: 'notification_counts_updated',
  READ: 'notification_read',
  ALL_READ: 'notification_all_read',
} as const;

interface NotificationWebsocketGateway {
  sendToUser(userId: string, event: string, data: unknown): Promise<void>;
}

@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);
  private websocketGateway: NotificationWebsocketGateway | null = null;

  constructor(
    private readonly redisService: RedisService,
    private readonly webPushService: WebPushService,
    private readonly preferencesService: NotificationPreferencesService,
  ) {}

  /**
   * Set the WebSocket gateway instance (called from module initialization)
   * This avoids circular dependency issues
   */
  setWebsocketGateway(gateway: NotificationWebsocketGateway): void {
    this.websocketGateway = gateway;
    this.logger.log('WebSocket gateway set for notification delivery');
  }

  /**
   * Deliver notification to a user.
   *
   * 1. WebSocket delivery always happens (feeds the in-app activity panel).
   * 2. Web Push delivery (OS-level notification) is gated by user preferences:
   *    - shouldNotify (type/category + DND check)
   *    - desktopEnabled preference
   */
  async deliverToUser(
    userId: string,
    notification: NotificationPayload,
  ): Promise<void> {
    // 1. WebSocket delivery — always happens regardless of preferences
    if (!this.websocketGateway) {
      this.logger.warn(
        'WebSocket gateway not initialized, skipping WS delivery',
      );
    } else {
      const isOnline = await this.isUserOnline(userId);

      if (isOnline) {
        await this.websocketGateway.sendToUser(
          userId,
          WS_NOTIFICATION_EVENTS.NEW,
          notification,
        );
      } else {
        this.logger.debug(
          `User ${userId} is offline, notification persisted for later`,
        );
      }
    }

    // 2. Web Push delivery — only if VAPID is configured and preferences allow
    if (this.webPushService.isEnabled()) {
      try {
        const { allowed, preferences } =
          await this.preferencesService.shouldNotify(
            userId,
            notification.type,
            notification.category,
          );

        if (allowed && preferences.desktopEnabled) {
          await this.webPushService.sendPush(userId, notification);
        }
      } catch (err) {
        this.logger.warn(
          `Web push failed for ${userId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  /**
   * Deliver notification to multiple users concurrently.
   * Uses Promise.allSettled so one user's failure doesn't block others.
   */
  async deliverToUsers(
    userIds: string[],
    notification: NotificationPayload,
  ): Promise<void> {
    await Promise.allSettled(
      userIds.map((userId) => this.deliverToUser(userId, notification)),
    );
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

  async broadcastNotificationAllRead(
    userId: string,
    category?: string,
    types?: NotificationType[],
  ): Promise<void> {
    if (!this.websocketGateway) {
      return;
    }

    const isOnline = await this.isUserOnline(userId);

    if (isOnline) {
      await this.websocketGateway.sendToUser(
        userId,
        WS_NOTIFICATION_EVENTS.ALL_READ,
        {
          category,
          types,
          readAt: new Date().toISOString(),
        },
      );
      this.logger.debug(`Sent notification all-read event to user ${userId}`);
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
