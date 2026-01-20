import { Injectable, Inject, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  lt,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type {
  NotificationCategory,
  NotificationType,
  NotificationPriority,
} from '@team9/database/schemas';

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

/**
 * Notification Service for im-worker
 * Handles notification creation and persistence
 * Read operations (getNotifications, getUnreadCounts) remain in Gateway
 */
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
  ): Promise<schema.Notification[]> {
    if (userIds.length === 0) return [];

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

    const notifications = await this.db
      .insert(schema.notifications)
      .values(values)
      .returning();

    this.logger.debug(
      `Created ${userIds.length} notifications of type ${params.type}`,
    );

    return notifications;
  }

  /**
   * Get actor info for a user
   */
  async getActorInfo(actorId: string): Promise<{
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null> {
    const [user] = await this.db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
      })
      .from(schema.users)
      .where(eq(schema.users.id, actorId))
      .limit(1);

    return user || null;
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
