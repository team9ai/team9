import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  index,
  customType,
} from 'drizzle-orm/pg-core';
import { messages } from './messages.js';
import { channels } from './channels.js';
import { users } from './users.js';
import { files } from './files.js';

// Custom type for PostgreSQL tsvector
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

// ==========================================
// Message Search Index Table
// ==========================================
export const messageSearch = pgTable(
  'im_message_search',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .unique()
      .references(() => messages.id, { onDelete: 'cascade' }),

    // Search vector (PostgreSQL tsvector type)
    searchVector: tsvector('search_vector').notNull(),

    // Content snapshot (for highlighting)
    contentSnapshot: text('content_snapshot'),

    // Filter fields (denormalized to avoid JOINs)
    channelId: uuid('channel_id').notNull(),
    channelName: varchar('channel_name', { length: 255 }),
    senderId: uuid('sender_id'),
    senderUsername: varchar('sender_username', { length: 100 }),
    senderDisplayName: varchar('sender_display_name', { length: 255 }),

    // Message flags
    messageType: varchar('message_type', { length: 32 }), // text | file | image | system
    hasAttachment: boolean('has_attachment').default(false).notNull(),
    isPinned: boolean('is_pinned').default(false).notNull(),
    isThreadReply: boolean('is_thread_reply').default(false).notNull(),

    // Multi-tenant
    tenantId: uuid('tenant_id'),

    // Timestamps
    messageCreatedAt: timestamp('message_created_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // GIN index for full-text search
    index('idx_message_search_vector').using('gin', table.searchVector),

    // Filter indexes
    index('idx_message_search_channel').on(table.channelId),
    index('idx_message_search_sender').on(table.senderId),
    index('idx_message_search_tenant').on(table.tenantId),
    index('idx_message_search_created').on(table.messageCreatedAt),

    // Composite index (tenant + time)
    index('idx_message_search_tenant_created').on(
      table.tenantId,
      table.messageCreatedAt,
    ),
  ],
);

export type MessageSearch = typeof messageSearch.$inferSelect;
export type NewMessageSearch = typeof messageSearch.$inferInsert;

// ==========================================
// Channel Search Index Table
// ==========================================
export const channelSearch = pgTable(
  'im_channel_search',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .notNull()
      .unique()
      .references(() => channels.id, { onDelete: 'cascade' }),

    // Search vector
    searchVector: tsvector('search_vector').notNull(),

    // Filter fields
    name: varchar('name', { length: 255 }),
    description: text('description'),
    channelType: varchar('channel_type', { length: 32 }), // direct | public | private
    memberCount: integer('member_count').default(0).notNull(),
    isArchived: boolean('is_archived').default(false).notNull(),

    // Multi-tenant
    tenantId: uuid('tenant_id'),

    // Timestamps
    channelCreatedAt: timestamp('channel_created_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_channel_search_vector').using('gin', table.searchVector),
    index('idx_channel_search_tenant').on(table.tenantId),
    index('idx_channel_search_type').on(table.channelType),
  ],
);

export type ChannelSearch = typeof channelSearch.$inferSelect;
export type NewChannelSearch = typeof channelSearch.$inferInsert;

// ==========================================
// User Search Index Table
// ==========================================
export const userSearch = pgTable(
  'im_user_search',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Search vector
    searchVector: tsvector('search_vector').notNull(),

    // Filter fields
    username: varchar('username', { length: 100 }),
    displayName: varchar('display_name', { length: 255 }),
    email: varchar('email', { length: 255 }),
    status: varchar('status', { length: 32 }), // online | offline | away | busy
    isActive: boolean('is_active').default(true).notNull(),

    // Timestamps
    userCreatedAt: timestamp('user_created_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_user_search_vector').using('gin', table.searchVector),
    index('idx_user_search_status').on(table.status),
  ],
);

export type UserSearch = typeof userSearch.$inferSelect;
export type NewUserSearch = typeof userSearch.$inferInsert;

// ==========================================
// File Search Index Table
// ==========================================
export const fileSearch = pgTable(
  'im_file_search',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: uuid('file_id')
      .notNull()
      .unique()
      .references(() => files.id, { onDelete: 'cascade' }),

    // Search vector
    searchVector: tsvector('search_vector').notNull(),

    // Filter fields
    fileName: varchar('file_name', { length: 500 }),
    mimeType: varchar('mime_type', { length: 255 }),
    fileSize: integer('file_size'),
    channelId: uuid('channel_id'),
    channelName: varchar('channel_name', { length: 255 }),
    uploaderId: uuid('uploader_id'),
    uploaderUsername: varchar('uploader_username', { length: 100 }),

    // Multi-tenant
    tenantId: uuid('tenant_id'),

    // Timestamps
    fileCreatedAt: timestamp('file_created_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_file_search_vector').using('gin', table.searchVector),
    index('idx_file_search_channel').on(table.channelId),
    index('idx_file_search_tenant').on(table.tenantId),
    index('idx_file_search_mime').on(table.mimeType),
  ],
);

export type FileSearch = typeof fileSearch.$inferSelect;
export type NewFileSearch = typeof fileSearch.$inferInsert;
