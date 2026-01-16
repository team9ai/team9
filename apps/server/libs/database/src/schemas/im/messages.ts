import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  pgEnum,
  jsonb,
  index,
  bigint,
  varchar,
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
    id: uuid('id').primaryKey().notNull(),
    channelId: uuid('channel_id')
      .references(() => channels.id, { onDelete: 'cascade' })
      .notNull(),
    senderId: uuid('sender_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Thread support: parentId = direct parent, rootId = thread root message
    // Root message: parentId = null, rootId = null
    // First-level reply: parentId = rootId (both point to root message)
    // Second-level reply: parentId = first-level reply, rootId = root message
    parentId: uuid('parent_id'),
    rootId: uuid('root_id'),
    content: text('content'),
    type: messageTypeEnum('type').default('text').notNull(),
    metadata: jsonb('metadata'),
    isPinned: boolean('is_pinned').default(false).notNull(),
    isEdited: boolean('is_edited').default(false).notNull(),
    isDeleted: boolean('is_deleted').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),

    // ============ Distributed IM Architecture Fields ============

    // Message sequence ID (unique within channel, for ordering)
    seqId: bigint('seq_id', { mode: 'bigint' }),

    // Client message ID (for deduplication)
    clientMsgId: varchar('client_msg_id', { length: 64 }),

    // Gateway node ID that received this message
    gatewayId: varchar('gateway_id', { length: 64 }),
  },
  (table) => [
    index('idx_messages_channel_id').on(table.channelId),
    index('idx_messages_sender_id').on(table.senderId),
    index('idx_messages_parent_id').on(table.parentId),
    index('idx_messages_root_id').on(table.rootId),
    index('idx_messages_created_at').on(table.createdAt),
    // New indexes for distributed architecture
    index('idx_messages_seq_id').on(table.channelId, table.seqId),
    index('idx_messages_client_msg_id').on(table.clientMsgId),
  ],
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
