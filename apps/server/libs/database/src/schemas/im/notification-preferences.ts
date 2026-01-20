import {
  pgTable,
  uuid,
  boolean,
  jsonb,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { channels } from './channels.js';

// User notification preferences
export const notificationPreferences = pgTable(
  'im_notification_preferences',
  {
    id: uuid('id').primaryKey().notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    // Global settings by notification category
    mentionsEnabled: boolean('mentions_enabled').default(true).notNull(),
    repliesEnabled: boolean('replies_enabled').default(true).notNull(),
    dmsEnabled: boolean('dms_enabled').default(true).notNull(),
    systemEnabled: boolean('system_enabled').default(true).notNull(),
    workspaceEnabled: boolean('workspace_enabled').default(true).notNull(),

    // Desktop/sound notifications
    desktopEnabled: boolean('desktop_enabled').default(true).notNull(),
    soundEnabled: boolean('sound_enabled').default(true).notNull(),

    // Do not disturb
    dndEnabled: boolean('dnd_enabled').default(false).notNull(),
    dndStart: timestamp('dnd_start'),
    dndEnd: timestamp('dnd_end'),

    // Advanced settings (JSON for flexibility)
    settings: jsonb('settings'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [unique('unique_user_notification_preferences').on(table.userId)],
);

// Per-channel notification mute settings
export const channelNotificationMutes = pgTable(
  'im_channel_notification_mutes',
  {
    id: uuid('id').primaryKey().notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    channelId: uuid('channel_id')
      .references(() => channels.id, { onDelete: 'cascade' })
      .notNull(),
    mutedUntil: timestamp('muted_until'), // null = permanently muted
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('unique_channel_notification_mute').on(
      table.userId,
      table.channelId,
    ),
    index('idx_channel_mutes_user').on(table.userId),
    index('idx_channel_mutes_channel').on(table.channelId),
  ],
);

export type NotificationPreferences =
  typeof notificationPreferences.$inferSelect;
export type NewNotificationPreferences =
  typeof notificationPreferences.$inferInsert;
export type ChannelNotificationMute =
  typeof channelNotificationMutes.$inferSelect;
export type NewChannelNotificationMute =
  typeof channelNotificationMutes.$inferInsert;
