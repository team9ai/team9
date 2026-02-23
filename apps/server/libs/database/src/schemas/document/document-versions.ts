import {
  pgTable,
  uuid,
  integer,
  text,
  timestamp,
  jsonb,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { documents, type DocumentIdentity } from './documents.js';

export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id').primaryKey().notNull(),

    documentId: uuid('document_id')
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),

    /** Human-readable sequential version number (1, 2, 3...) */
    versionIndex: integer('version_index').notNull(),

    /** Markdown content */
    content: text('content').notNull(),

    /** Optional change summary */
    summary: text('summary'),

    /** Who created this version */
    updatedBy: jsonb('updated_by').$type<DocumentIdentity>().notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_document_versions_document_id').on(table.documentId),
    unique('uq_document_versions_doc_version').on(
      table.documentId,
      table.versionIndex,
    ),
  ],
);

export type DocumentVersion = typeof documentVersions.$inferSelect;
export type NewDocumentVersion = typeof documentVersions.$inferInsert;
