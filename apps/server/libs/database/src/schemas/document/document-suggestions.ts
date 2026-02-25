import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { documents, type DocumentIdentity } from './documents.js';
import { documentVersions } from './document-versions.js';

// ── Types ────────────────────────────────────────────────────────────

export const documentSuggestionStatusEnum = pgEnum(
  'document_suggestion_status',
  ['pending', 'approved', 'rejected'],
);

/** Suggestion payload — extensible via discriminated union */
export type DocumentSuggestionData = {
  type: 'replace';
  content: string;
};
// Future extensions:
// | { type: 'patch'; patches: unknown[] }
// | { type: 'append'; content: string }

// ── Table ────────────────────────────────────────────────────────────

export const documentSuggestions = pgTable(
  'document_suggestions',
  {
    id: uuid('id').primaryKey().notNull(),

    documentId: uuid('document_id')
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),

    /** The version this suggestion is based on */
    fromVersionId: uuid('from_version_id')
      .references(() => documentVersions.id)
      .notNull(),

    /** Who submitted this suggestion */
    suggestedBy: jsonb('suggested_by').$type<DocumentIdentity>().notNull(),

    /** Suggestion payload: { type: 'replace', content: '...' } */
    data: jsonb('data').$type<DocumentSuggestionData>().notNull(),

    /** Human-readable description of the change */
    summary: text('summary'),

    status: documentSuggestionStatusEnum('status').default('pending').notNull(),

    /** Who reviewed this suggestion */
    reviewedBy: jsonb('reviewed_by').$type<DocumentIdentity>(),

    reviewedAt: timestamp('reviewed_at'),

    /** If approved, the version that was created from this suggestion */
    resultVersionId: uuid('result_version_id').references(
      () => documentVersions.id,
    ),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_document_suggestions_document_id').on(table.documentId),
    index('idx_document_suggestions_status').on(table.status),
  ],
);

export type DocumentSuggestion = typeof documentSuggestions.$inferSelect;
export type NewDocumentSuggestion = typeof documentSuggestions.$inferInsert;
export type DocumentSuggestionStatus =
  (typeof documentSuggestionStatusEnum.enumValues)[number];
