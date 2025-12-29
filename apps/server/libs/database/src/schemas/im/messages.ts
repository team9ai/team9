import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  pgEnum,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { channels } from './channels.js';

export const messageTypeEnum = pgEnum('message_type', [
  'text',
  'file',
  'image',
  'system',
]);

export const messages = pgTable(
  'im_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .references(() => channels.id, { onDelete: 'cascade' })
      .notNull(),
    senderId: uuid('sender_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    parentId: uuid('parent_id'),
    content: text('content'),
    type: messageTypeEnum('type').default('text').notNull(),
    metadata: jsonb('metadata'),
    isPinned: boolean('is_pinned').default(false).notNull(),
    isEdited: boolean('is_edited').default(false).notNull(),
    isDeleted: boolean('is_deleted').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('idx_messages_channel_id').on(table.channelId),
    index('idx_messages_sender_id').on(table.senderId),
    index('idx_messages_parent_id').on(table.parentId),
    index('idx_messages_created_at').on(table.createdAt),
  ],
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
