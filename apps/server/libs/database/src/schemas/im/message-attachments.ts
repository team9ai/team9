import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { messages } from './messages.js';

export const messageAttachments = pgTable(
  'im_message_attachments',
  {
    id: uuid('id').primaryKey().notNull(),
    messageId: uuid('message_id')
      .references(() => messages.id, { onDelete: 'cascade' })
      .notNull(),
    fileName: varchar('file_name', { length: 500 }).notNull(),
    // fileKey is null for external pass-through attachments where bytes
    // already live at a stable third-party URL (fileUrl) and were never
    // uploaded into team9's own S3.
    fileKey: varchar('file_key', { length: 500 }),
    fileUrl: text('file_url').notNull(),
    fileSize: integer('file_size').notNull(),
    mimeType: varchar('mime_type', { length: 255 }).notNull(),
    thumbnailUrl: text('thumbnail_url'),
    width: integer('width'),
    height: integer('height'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_message_attachments_message_id').on(table.messageId)],
);

export type MessageAttachment = typeof messageAttachments.$inferSelect;
export type NewMessageAttachment = typeof messageAttachments.$inferInsert;
