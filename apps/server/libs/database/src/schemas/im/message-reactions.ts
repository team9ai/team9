import { pgTable, uuid, varchar, timestamp, unique } from 'drizzle-orm/pg-core';
import { messages } from './messages';
import { users } from './users';

export const messageReactions = pgTable(
  'im_message_reactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .references(() => messages.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    emoji: varchar('emoji', { length: 50 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('unique_reaction').on(table.messageId, table.userId, table.emoji),
  ],
);

export type MessageReaction = typeof messageReactions.$inferSelect;
export type NewMessageReaction = typeof messageReactions.$inferInsert;
