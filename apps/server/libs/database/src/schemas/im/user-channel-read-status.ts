import { pgTable, uuid, timestamp, integer, unique } from 'drizzle-orm/pg-core';
import { users } from './users';
import { channels } from './channels';
import { messages } from './messages';

export const userChannelReadStatus = pgTable(
  'im_user_channel_read_status',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    channelId: uuid('channel_id')
      .references(() => channels.id, { onDelete: 'cascade' })
      .notNull(),
    lastReadMessageId: uuid('last_read_message_id').references(
      () => messages.id,
    ),
    lastReadAt: timestamp('last_read_at').defaultNow().notNull(),
    unreadCount: integer('unread_count').default(0).notNull(),
  },
  (table) => [
    unique('unique_user_channel_read').on(table.userId, table.channelId),
  ],
);

export type UserChannelReadStatus = typeof userChannelReadStatus.$inferSelect;
export type NewUserChannelReadStatus =
  typeof userChannelReadStatus.$inferInsert;
