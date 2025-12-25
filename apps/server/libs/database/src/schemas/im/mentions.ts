import {
  pgTable,
  uuid,
  timestamp,
  boolean,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { messages } from './messages';
import { users } from './users';
import { channels } from './channels';

export const mentionTypeEnum = pgEnum('mention_type', [
  'user',
  'channel',
  'everyone',
  'here',
]);

export const mentions = pgTable(
  'im_mentions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .references(() => messages.id, { onDelete: 'cascade' })
      .notNull(),
    mentionedUserId: uuid('mentioned_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    mentionedChannelId: uuid('mentioned_channel_id').references(
      () => channels.id,
      { onDelete: 'cascade' },
    ),
    type: mentionTypeEnum('type').notNull(),
    isRead: boolean('is_read').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_mentions_user_id').on(table.mentionedUserId),
    index('idx_mentions_message_id').on(table.messageId),
  ],
);

export type Mention = typeof mentions.$inferSelect;
export type NewMention = typeof mentions.$inferInsert;
