import {
  pgTable,
  uuid,
  timestamp,
  pgEnum,
  boolean,
  unique,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { channels } from './channels.js';

export const memberRoleEnum = pgEnum('member_role', [
  'owner',
  'admin',
  'member',
]);

export const channelMembers = pgTable(
  'im_channel_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .references(() => channels.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    role: memberRoleEnum('role').default('member').notNull(),
    isMuted: boolean('is_muted').default(false).notNull(),
    notificationsEnabled: boolean('notifications_enabled')
      .default(true)
      .notNull(),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
    leftAt: timestamp('left_at'),
  },
  (table) => [unique('unique_channel_user').on(table.channelId, table.userId)],
);

export type ChannelMember = typeof channelMembers.$inferSelect;
export type NewChannelMember = typeof channelMembers.$inferInsert;
