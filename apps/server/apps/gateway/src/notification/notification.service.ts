import { Injectable, Inject, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  desc,
  lt,
  inArray,
  sql,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type {
  NotificationCategory,
  NotificationType,
  NotificationPriority,
} from '@team9/database/schemas';

export interface NotificationActor {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface NotificationResponse {
  id: string;
  category: NotificationCategory;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string | null;
  actor: NotificationActor | null;
  tenantId: string | null;
  channelId: string | null;
  messageId: string | null;
  actionUrl: string | null;
  isRead: boolean;
  createdAt: Date;
}

export interface NotificationCountsResponse {
  total: number;
  byCategory: {
    message: number;
    system: number;
    workspace: number;
  };
  byType: {
    // Message category
    mention: number;
    channel_mention: number;
    everyone_mention: number;
    here_mention: number;
    reply: number;
    thread_reply: number;
    dm_received: number;
    // System category
    system_announcement: number;
    maintenance_notice: number;
    version_update: number;
    // Workspace category
    workspace_invitation: number;
    role_changed: number;
    member_joined: number;
    member_left: number;
    channel_invite: number;
  };
}

export interface CreateNotificationParams {
  userId: string;
  category: NotificationCategory;
  type: NotificationType;
  title: string;
  body?: string;
  actorId?: string;
  tenantId?: string;
  channelId?: string;
  messageId?: string;
  referenceType?: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
  actionUrl?: string;
  priority?: NotificationPriority;
  expiresAt?: Date;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Create a new notification
   */
  async create(params: CreateNotificationParams): Promise<schema.Notification> {
    const [notification] = await this.db
      .insert(schema.notifications)
      .values({
        id: uuidv7(),
        userId: params.userId,
        category: params.category,
        type: params.type,
        title: params.title,
        body: params.body,
        actorId: params.actorId,
        tenantId: params.tenantId,
        channelId: params.channelId,
        messageId: params.messageId,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        metadata: params.metadata,
        actionUrl: params.actionUrl,
        priority: params.priority || 'normal',
        expiresAt: params.expiresAt,
      })
      .returning();

    this.logger.debug(
      `Created notification ${notification.id} for user ${params.userId}`,
    );

    return notification;
  }

  /**
   * Create notifications for multiple users (batch)
   */
  async createBatch(
    userIds: string[],
    params: Omit<CreateNotificationParams, 'userId'>,
  ): Promise<void> {
    if (userIds.length === 0) return;

    const values = userIds.map((userId) => ({
      id: uuidv7(),
      userId,
      category: params.category,
      type: params.type,
      title: params.title,
      body: params.body,
      actorId: params.actorId,
      tenantId: params.tenantId,
      channelId: params.channelId,
      messageId: params.messageId,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      metadata: params.metadata,
      actionUrl: params.actionUrl,
      priority: params.priority || 'normal',
      expiresAt: params.expiresAt,
    }));

    await this.db.insert(schema.notifications).values(values);

    this.logger.debug(
      `Created ${userIds.length} notifications of type ${params.type}`,
    );
  }

  /**
   * Get notifications for a user with cursor-based pagination
   */
  async getNotifications(
    userId: string,
    options?: {
      category?: string;
      type?: string;
      isRead?: boolean;
      limit?: number;
      cursor?: string;
    },
  ): Promise<{
    notifications: NotificationResponse[];
    nextCursor: string | null;
  }> {
    const limit = options?.limit ?? 20;
    const conditions: ReturnType<typeof eq>[] = [
      eq(schema.notifications.userId, userId),
      eq(schema.notifications.isArchived, false),
    ];

    if (options?.category) {
      conditions.push(
        eq(
          schema.notifications.category,
          options.category as NotificationCategory,
        ),
      );
    }
    if (options?.type) {
      conditions.push(
        eq(schema.notifications.type, options.type as NotificationType),
      );
    }
    if (options?.isRead !== undefined) {
      conditions.push(eq(schema.notifications.isRead, options.isRead));
    }
    if (options?.cursor) {
      const cursorDate = new Date(options.cursor);
      conditions.push(lt(schema.notifications.createdAt, cursorDate));
    }

    const results = await this.db
      .select({
        notification: schema.notifications,
        actor: {
          id: schema.users.id,
          username: schema.users.username,
          displayName: schema.users.displayName,
          avatarUrl: schema.users.avatarUrl,
        },
      })
      .from(schema.notifications)
      .leftJoin(schema.users, eq(schema.notifications.actorId, schema.users.id))
      .where(and(...conditions))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(limit + 1);

    const hasMore = results.length > limit;
    const items = results.slice(0, limit);

    const notifications: NotificationResponse[] = items.map((r) => ({
      id: r.notification.id,
      category: r.notification.category,
      type: r.notification.type,
      priority: r.notification.priority,
      title: r.notification.title,
      body: r.notification.body,
      actor: r.actor?.id ? (r.actor as NotificationActor) : null,
      tenantId: r.notification.tenantId,
      channelId: r.notification.channelId,
      messageId: r.notification.messageId,
      actionUrl: r.notification.actionUrl,
      isRead: r.notification.isRead,
      createdAt: r.notification.createdAt,
    }));

    const lastItem = items[items.length - 1];
    const nextCursor =
      hasMore && lastItem
        ? lastItem.notification.createdAt.toISOString()
        : null;

    return { notifications, nextCursor };
  }

  /**
   * Get unread notification counts by category and type
   */
  async getUnreadCounts(userId: string): Promise<NotificationCountsResponse> {
    const baseConditions = and(
      eq(schema.notifications.userId, userId),
      eq(schema.notifications.isRead, false),
      eq(schema.notifications.isArchived, false),
    );

    // Query counts grouped by category
    const categoryResults = await this.db
      .select({
        category: schema.notifications.category,
        count: sql<number>`COUNT(*)`,
      })
      .from(schema.notifications)
      .where(baseConditions)
      .groupBy(schema.notifications.category);

    // Query counts grouped by type
    const typeResults = await this.db
      .select({
        type: schema.notifications.type,
        count: sql<number>`COUNT(*)`,
      })
      .from(schema.notifications)
      .where(baseConditions)
      .groupBy(schema.notifications.type);

    const counts: NotificationCountsResponse = {
      total: 0,
      byCategory: {
        message: 0,
        system: 0,
        workspace: 0,
      },
      byType: {
        // Message category
        mention: 0,
        channel_mention: 0,
        everyone_mention: 0,
        here_mention: 0,
        reply: 0,
        thread_reply: 0,
        dm_received: 0,
        // System category
        system_announcement: 0,
        maintenance_notice: 0,
        version_update: 0,
        // Workspace category
        workspace_invitation: 0,
        role_changed: 0,
        member_joined: 0,
        member_left: 0,
        channel_invite: 0,
      },
    };

    // Populate category counts
    categoryResults.forEach((r) => {
      const count = Number(r.count);
      counts.byCategory[r.category as keyof typeof counts.byCategory] = count;
      counts.total += count;
    });

    // Populate type counts
    typeResults.forEach((r) => {
      const count = Number(r.count);
      counts.byType[r.type as keyof typeof counts.byType] = count;
    });

    return counts;
  }

  /**
   * Mark notifications as read
   */
  async markAsRead(userId: string, notificationIds: string[]): Promise<void> {
    await this.db
      .update(schema.notifications)
      .set({
        isRead: true,
        readAt: new Date(),
      })
      .where(
        and(
          eq(schema.notifications.userId, userId),
          inArray(schema.notifications.id, notificationIds),
        ),
      );

    this.logger.debug(
      `Marked ${notificationIds.length} notifications as read for user ${userId}`,
    );
  }

  /**
   * Mark all notifications as read (optionally by category)
   */
  async markAllAsRead(userId: string, category?: string): Promise<void> {
    const conditions: ReturnType<typeof eq>[] = [
      eq(schema.notifications.userId, userId),
      eq(schema.notifications.isRead, false),
    ];

    if (category) {
      conditions.push(
        eq(schema.notifications.category, category as NotificationCategory),
      );
    }

    await this.db
      .update(schema.notifications)
      .set({
        isRead: true,
        readAt: new Date(),
      })
      .where(and(...conditions));

    this.logger.debug(
      `Marked all ${category || 'all'} notifications as read for user ${userId}`,
    );
  }

  /**
   * Archive notifications (dismiss without delete)
   */
  async archive(userId: string, notificationIds: string[]): Promise<void> {
    await this.db
      .update(schema.notifications)
      .set({
        isArchived: true,
        archivedAt: new Date(),
      })
      .where(
        and(
          eq(schema.notifications.userId, userId),
          inArray(schema.notifications.id, notificationIds),
        ),
      );

    this.logger.debug(
      `Archived ${notificationIds.length} notifications for user ${userId}`,
    );
  }

  /**
   * Delete old notifications (cleanup job)
   */
  async cleanupExpired(): Promise<number> {
    const result = await this.db
      .delete(schema.notifications)
      .where(lt(schema.notifications.expiresAt, new Date()))
      .returning({ id: schema.notifications.id });

    this.logger.log(`Cleaned up ${result.length} expired notifications`);
    return result.length;
  }

  /**
   * Delete notifications by message ID (when message is deleted)
   */
  async deleteByMessageId(messageId: string): Promise<void> {
    await this.db
      .delete(schema.notifications)
      .where(eq(schema.notifications.messageId, messageId));
  }
}
