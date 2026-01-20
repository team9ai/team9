import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  pgEnum,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { messages } from './messages.js';
import { channels } from './channels.js';
import { tenants } from '../tenant/tenants.js';

// Notification category enum
export const notificationCategoryEnum = pgEnum('notification_category', [
  'message', // Message-related: mentions, replies, DMs
  'system', // System: announcements, maintenance, updates
  'workspace', // Workspace: invitations, role changes, member events
]);

// Notification type enum - detailed types within each category
export const notificationTypeEnum = pgEnum('notification_type', [
  // Message category
  'mention', // @user mention
  'channel_mention', // @channel mention
  'everyone_mention', // @everyone mention
  'here_mention', // @here mention
  'reply', // Reply to user's message
  'thread_reply', // Reply in a thread user participates in
  'dm_received', // Direct message received

  // System category
  'system_announcement', // System-wide announcement
  'maintenance_notice', // Scheduled maintenance
  'version_update', // New version available

  // Workspace category
  'workspace_invitation', // Invited to workspace
  'role_changed', // User's role changed
  'member_joined', // New member joined workspace
  'member_left', // Member left workspace
  'channel_invite', // Invited to channel
]);

// Notification priority for ordering
export const notificationPriorityEnum = pgEnum('notification_priority', [
  'low', // Informational
  'normal', // Standard notifications
  'high', // Important (mentions, DMs)
  'urgent', // Critical (security alerts)
]);

export const notifications = pgTable(
  'im_notifications',
  {
    id: uuid('id').primaryKey().notNull(),

    // Target user receiving the notification
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    // Notification classification
    category: notificationCategoryEnum('category').notNull(),
    type: notificationTypeEnum('type').notNull(),
    priority: notificationPriorityEnum('priority').default('normal').notNull(),

    // Title and body for display
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body'),

    // Actor who triggered the notification (optional for system notifications)
    actorId: uuid('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    // Context references (all optional, depends on notification type)
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    channelId: uuid('channel_id').references(() => channels.id, {
      onDelete: 'cascade',
    }),
    messageId: uuid('message_id').references(() => messages.id, {
      onDelete: 'cascade',
    }),

    // Flexible reference for other entity types (e.g., invitation ID)
    referenceType: varchar('reference_type', { length: 50 }),
    referenceId: uuid('reference_id'),

    // Additional metadata (extensible)
    metadata: jsonb('metadata'),

    // Deep link for navigation (e.g., /workspace/abc/channel/xyz/message/123)
    actionUrl: text('action_url'),

    // Read status
    isRead: boolean('is_read').default(false).notNull(),
    readAt: timestamp('read_at'),

    // Archived status (for dismissing without deleting)
    isArchived: boolean('is_archived').default(false).notNull(),
    archivedAt: timestamp('archived_at'),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at'), // Optional expiration for time-sensitive notifications
  },
  (table) => [
    // Primary query: user's unread notifications
    index('idx_notifications_user_unread').on(
      table.userId,
      table.isRead,
      table.isArchived,
      table.createdAt,
    ),
    // Query by user and category
    index('idx_notifications_user_category').on(
      table.userId,
      table.category,
      table.isRead,
    ),
    // Query by user and type
    index('idx_notifications_user_type').on(
      table.userId,
      table.type,
      table.isRead,
    ),
    // Cleanup expired notifications
    index('idx_notifications_expires').on(table.expiresAt),
    // Reference lookup
    index('idx_notifications_reference').on(
      table.referenceType,
      table.referenceId,
    ),
    // Message-based notifications lookup
    index('idx_notifications_message').on(table.messageId),
    // Channel-based notifications lookup
    index('idx_notifications_channel').on(table.channelId),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationCategory =
  (typeof notificationCategoryEnum.enumValues)[number];
export type NotificationType = (typeof notificationTypeEnum.enumValues)[number];
export type NotificationPriority =
  (typeof notificationPriorityEnum.enumValues)[number];
