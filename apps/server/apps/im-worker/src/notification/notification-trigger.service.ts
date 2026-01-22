import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  isNull,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import {
  NOTIFICATION_TYPE_PRIORITY,
  type NotificationDeliveryTask,
  type NotificationActorInfo,
} from '@team9/shared';
import { RabbitMQEventService } from '@team9/rabbitmq';
import {
  NotificationService,
  CreateNotificationParams,
} from './notification.service.js';

export type MentionType = 'user' | 'channel' | 'everyone' | 'here';

export interface MentionNotificationParams {
  messageId: string;
  channelId: string;
  tenantId: string;
  senderId: string;
  senderUsername: string;
  channelName: string;
  content: string;
  mentions: Array<{
    userId?: string;
    type: MentionType;
  }>;
}

export interface ReplyNotificationParams {
  messageId: string;
  channelId: string;
  tenantId: string;
  senderId: string;
  senderUsername: string;
  parentMessageId: string;
  parentSenderId: string;
  content: string;
}

export interface WorkspaceInvitationNotificationParams {
  invitationId: string;
  tenantId: string;
  tenantName: string;
  inviterId: string;
  inviterUsername: string;
  inviteeId: string;
}

export interface DMNotificationParams {
  messageId: string;
  channelId: string;
  senderId: string;
  senderUsername: string;
  recipientId: string;
  content: string;
}

export interface MemberJoinedNotificationParams {
  tenantId: string;
  tenantName: string;
  newMemberId: string;
  newMemberUsername: string;
  notifyUserIds: string[];
}

export interface RoleChangedNotificationParams {
  tenantId: string;
  tenantName: string;
  userId: string;
  oldRole: string;
  newRole: string;
  changedById: string;
  changedByUsername: string;
}

/**
 * Notification Trigger Service for im-worker
 * Creates notifications and publishes delivery tasks to Gateway via RabbitMQ
 */
@Injectable()
export class NotificationTriggerService {
  private readonly logger = new Logger(NotificationTriggerService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly rabbitMQEventService: RabbitMQEventService,
  ) {}

  /**
   * Trigger mention notifications using collect-aggregate-dedupe pattern
   *
   * When a message has multiple mention types (e.g., @user AND @everyone),
   * each user receives only ONE notification with the highest priority type.
   * Priority order: @user (100) > @everyone (80) > @here (70)
   *
   * This follows Slack's behavior where direct @mentions take precedence
   * over broadcast mentions for the same user.
   */
  async triggerMentionNotifications(
    params: MentionNotificationParams,
  ): Promise<void> {
    const {
      messageId,
      channelId,
      tenantId,
      senderId,
      senderUsername,
      channelName,
      content,
      mentions,
    } = params;

    const truncatedContent =
      content.length > 100 ? content.substring(0, 100) + '...' : content;

    // Step 1: Collect all notification candidates
    const candidates: Array<{
      userId: string;
      type: 'mention' | 'everyone_mention' | 'here_mention';
      priority: number;
      title: string;
    }> = [];

    // Collect @user mentions (highest priority)
    const userMentions = mentions.filter((m) => m.type === 'user' && m.userId);
    for (const mention of userMentions) {
      if (mention.userId === senderId) continue; // Don't notify self
      candidates.push({
        userId: mention.userId!,
        type: 'mention',
        priority: NOTIFICATION_TYPE_PRIORITY['mention'] ?? 100,
        title: `${senderUsername} mentioned you in #${channelName}`,
      });
    }

    // Collect @everyone mentions
    const hasEveryone = mentions.some((m) => m.type === 'everyone');
    if (hasEveryone) {
      const memberIds = await this.getChannelMemberIds(channelId);
      for (const userId of memberIds) {
        if (userId === senderId) continue;
        candidates.push({
          userId,
          type: 'everyone_mention',
          priority: NOTIFICATION_TYPE_PRIORITY['everyone_mention'] ?? 80,
          title: `${senderUsername} mentioned @everyone in #${channelName}`,
        });
      }
    }

    // Collect @here mentions (only if no @everyone, as @everyone takes precedence)
    const hasHere = mentions.some((m) => m.type === 'here');
    if (hasHere && !hasEveryone) {
      const memberIds = await this.getChannelMemberIds(channelId);
      for (const userId of memberIds) {
        if (userId === senderId) continue;
        candidates.push({
          userId,
          type: 'here_mention',
          priority: NOTIFICATION_TYPE_PRIORITY['here_mention'] ?? 70,
          title: `${senderUsername} mentioned @here in #${channelName}`,
        });
      }
    }

    // Step 2: Aggregate by userId, keeping only the highest priority notification
    const aggregated = new Map<
      string,
      { type: 'mention' | 'everyone_mention' | 'here_mention'; title: string }
    >();

    for (const candidate of candidates) {
      const existing = aggregated.get(candidate.userId);
      if (!existing) {
        aggregated.set(candidate.userId, {
          type: candidate.type,
          title: candidate.title,
        });
      } else {
        // Keep the higher priority notification
        const existingPriority = NOTIFICATION_TYPE_PRIORITY[existing.type] ?? 0;
        if (candidate.priority > existingPriority) {
          aggregated.set(candidate.userId, {
            type: candidate.type,
            title: candidate.title,
          });
        }
      }
    }

    // Step 3: Create and publish notifications (one per user)
    for (const [userId, { type, title }] of aggregated) {
      await this.createAndPublishDelivery({
        userId,
        category: 'message',
        type,
        title,
        body: truncatedContent,
        actorId: senderId,
        tenantId,
        channelId,
        messageId,
        actionUrl: `/channels/${channelId}?message=${messageId}`,
        priority: 'high',
      });
    }

    this.logger.debug(
      `Triggered ${aggregated.size} mention notifications for message ${messageId} (from ${candidates.length} candidates)`,
    );
  }

  /**
   * Trigger reply notification
   */
  async triggerReplyNotification(
    params: ReplyNotificationParams,
  ): Promise<void> {
    const {
      messageId,
      channelId,
      tenantId,
      senderId,
      senderUsername,
      parentSenderId,
      content,
    } = params;

    if (senderId === parentSenderId) return; // Don't notify self

    const truncatedContent =
      content.length > 100 ? content.substring(0, 100) + '...' : content;

    await this.createAndPublishDelivery({
      userId: parentSenderId,
      category: 'message',
      type: 'reply',
      title: `${senderUsername} replied to your message`,
      body: truncatedContent,
      actorId: senderId,
      tenantId,
      channelId,
      messageId,
      actionUrl: `/workspace/${tenantId}/channel/${channelId}?message=${messageId}`,
      priority: 'normal',
    });

    this.logger.debug(`Triggered reply notification for message ${messageId}`);
  }

  /**
   * Trigger DM notification
   */
  async triggerDMNotification(params: DMNotificationParams): Promise<void> {
    const {
      messageId,
      channelId,
      senderId,
      senderUsername,
      recipientId,
      content,
    } = params;

    if (senderId === recipientId) return;

    const truncatedContent =
      content.length > 100 ? content.substring(0, 100) + '...' : content;

    await this.createAndPublishDelivery({
      userId: recipientId,
      category: 'message',
      type: 'dm_received',
      title: `${senderUsername} sent you a message`,
      body: truncatedContent,
      actorId: senderId,
      channelId,
      messageId,
      actionUrl: `/channels/${channelId}?message=${messageId}`,
      priority: 'high',
    });

    this.logger.debug(`Triggered DM notification for message ${messageId}`);
  }

  /**
   * Trigger workspace invitation notification
   */
  async triggerWorkspaceInvitation(
    params: WorkspaceInvitationNotificationParams,
  ): Promise<void> {
    const {
      invitationId,
      tenantId,
      tenantName,
      inviterId,
      inviterUsername,
      inviteeId,
    } = params;

    await this.createAndPublishDelivery({
      userId: inviteeId,
      category: 'workspace',
      type: 'workspace_invitation',
      title: `${inviterUsername} invited you to ${tenantName}`,
      body: 'Click to accept the invitation and join the workspace.',
      actorId: inviterId,
      tenantId,
      referenceType: 'workspace_invitation',
      referenceId: invitationId,
      actionUrl: `/invite/${invitationId}`,
      priority: 'high',
    });

    this.logger.debug(
      `Triggered workspace invitation notification for user ${inviteeId}`,
    );
  }

  /**
   * Trigger member joined notification
   */
  async triggerMemberJoined(
    params: MemberJoinedNotificationParams,
  ): Promise<void> {
    const {
      tenantId,
      tenantName,
      newMemberId,
      newMemberUsername,
      notifyUserIds,
    } = params;

    for (const userId of notifyUserIds) {
      if (userId === newMemberId) continue;

      await this.createAndPublishDelivery({
        userId,
        category: 'workspace',
        type: 'member_joined',
        title: `${newMemberUsername} joined ${tenantName}`,
        body: undefined,
        actorId: newMemberId,
        tenantId,
        actionUrl: `/`,
        priority: 'low',
      });
    }

    this.logger.debug(
      `Triggered member joined notifications for workspace ${tenantId}`,
    );
  }

  /**
   * Trigger role changed notification
   */
  async triggerRoleChanged(
    params: RoleChangedNotificationParams,
  ): Promise<void> {
    const {
      tenantId,
      tenantName,
      userId,
      oldRole,
      newRole,
      changedById,
      changedByUsername,
    } = params;

    await this.createAndPublishDelivery({
      userId,
      category: 'workspace',
      type: 'role_changed',
      title: `Your role in ${tenantName} was changed`,
      body: `${changedByUsername} changed your role from ${oldRole} to ${newRole}.`,
      actorId: changedById,
      tenantId,
      metadata: { oldRole, newRole },
      actionUrl: `/`,
      priority: 'normal',
    });

    this.logger.debug(`Triggered role changed notification for user ${userId}`);
  }

  /**
   * Trigger system announcement notification
   */
  async triggerSystemAnnouncement(
    userIds: string[],
    title: string,
    body: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const notifications = await this.notificationService.createBatch(userIds, {
      category: 'system',
      type: 'system_announcement',
      title,
      body,
      metadata,
      priority: 'normal',
    });

    // Publish delivery tasks for all users
    for (const notification of notifications) {
      await this.publishDeliveryTask(notification);
    }

    this.logger.debug(
      `Triggered system announcement to ${userIds.length} users`,
    );
  }

  /**
   * Helper to create notification and publish delivery task to Gateway
   */
  private async createAndPublishDelivery(
    params: CreateNotificationParams,
  ): Promise<void> {
    const notification = await this.notificationService.create(params);
    await this.publishDeliveryTask(notification);
  }

  /**
   * Publish delivery task to RabbitMQ for Gateway to push via WebSocket
   */
  private async publishDeliveryTask(
    notification: schema.Notification,
  ): Promise<void> {
    // Get actor info if available
    let actor: NotificationActorInfo | null = null;
    if (notification.actorId) {
      actor = await this.notificationService.getActorInfo(notification.actorId);
    }

    const deliveryTask: NotificationDeliveryTask = {
      type: 'new',
      userId: notification.userId,
      timestamp: Date.now(),
      payload: {
        id: notification.id,
        category: notification.category,
        type: notification.type,
        priority: notification.priority,
        title: notification.title,
        body: notification.body,
        actor,
        tenantId: notification.tenantId,
        channelId: notification.channelId,
        messageId: notification.messageId,
        actionUrl: notification.actionUrl,
        createdAt: notification.createdAt.toISOString(),
      },
    };

    await this.rabbitMQEventService.publishDeliveryTask(deliveryTask);
  }

  /**
   * Get channel member IDs
   */
  private async getChannelMemberIds(channelId: string): Promise<string[]> {
    const members = await this.db
      .select({ userId: schema.channelMembers.userId })
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          isNull(schema.channelMembers.leftAt),
        ),
      );

    return members.map((m) => m.userId);
  }
}
