import {
  pgTable,
  uuid,
  integer,
  timestamp,
  jsonb,
  varchar,
  bigint,
  index,
} from 'drizzle-orm/pg-core';
import { messages } from './messages.js';
import { channels } from './channels.js';
import { tenants } from '../tenant/tenants.js';
import { users } from './users.js';

export interface ForwardAttachmentSnapshot {
  originalAttachmentId: string;
  fileName: string;
  fileUrl: string;
  fileKey: string | null;
  fileSize: number;
  mimeType: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}

export const messageForwards = pgTable(
  'im_message_forwards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    forwardedMessageId: uuid('forwarded_message_id')
      .references(() => messages.id, { onDelete: 'cascade' })
      .notNull(),
    position: integer('position').notNull(),
    sourceMessageId: uuid('source_message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    sourceChannelId: uuid('source_channel_id')
      .references(() => channels.id)
      .notNull(),
    sourceWorkspaceId: uuid('source_workspace_id').references(
      () => tenants.id,
      { onDelete: 'set null' },
    ),
    sourceSenderId: uuid('source_sender_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    sourceCreatedAt: timestamp('source_created_at').notNull(),
    sourceSeqId: bigint('source_seq_id', { mode: 'bigint' }),
    contentSnapshot: varchar('content_snapshot', { length: 100_000 }),
    contentAstSnapshot: jsonb('content_ast_snapshot').$type<
      Record<string, unknown>
    >(),
    attachmentsSnapshot: jsonb('attachments_snapshot').$type<
      ForwardAttachmentSnapshot[]
    >(),
    sourceType: varchar('source_type', { length: 32 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_mf_forwarded').on(table.forwardedMessageId),
    index('idx_mf_source_msg').on(table.sourceMessageId),
    index('idx_mf_source_channel').on(table.sourceChannelId),
    index('idx_mf_source_workspace').on(table.sourceWorkspaceId),
  ],
);

export type MessageForward = typeof messageForwards.$inferSelect;
export type NewMessageForward = typeof messageForwards.$inferInsert;
