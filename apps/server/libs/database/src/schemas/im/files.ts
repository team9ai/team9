import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { channels } from './channels.js';
import { tenants } from '../tenant/tenants.js';

export const fileVisibilityEnum = pgEnum('file_visibility', [
  'private', // Only uploader can access
  'channel', // Channel members can access
  'workspace', // Workspace members can access
  'public', // Anyone can access (no auth required)
]);

export const files = pgTable(
  'im_files',
  {
    id: uuid('id').primaryKey().notNull(),
    key: varchar('key', { length: 500 }).notNull(),
    bucket: varchar('bucket', { length: 255 }).notNull(),
    fileName: varchar('file_name', { length: 500 }).notNull(),
    fileSize: integer('file_size').notNull(),
    mimeType: varchar('mime_type', { length: 255 }).notNull(),
    visibility: fileVisibilityEnum('visibility').default('workspace').notNull(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    channelId: uuid('channel_id').references(() => channels.id, {
      onDelete: 'set null',
    }),
    uploaderId: uuid('uploader_id')
      .references(() => users.id, { onDelete: 'set null' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_files_key').on(table.key),
    index('idx_files_tenant').on(table.tenantId),
    index('idx_files_channel').on(table.channelId),
    index('idx_files_uploader').on(table.uploaderId),
  ],
);

export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
export type FileVisibility = (typeof fileVisibilityEnum.enumValues)[number];
