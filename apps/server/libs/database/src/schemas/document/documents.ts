import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from '../tenant/tenants.js';

// ── Types ────────────────────────────────────────────────────────────

/** Identity for a specific user */
export interface UserIdentity {
  type: 'user';
  id: string;
}

/** Identity for a specific bot */
export interface BotIdentity {
  type: 'bot';
  id: string;
}

/** Identity for all members (or a subset) of a workspace */
export interface WorkspaceIdentity {
  type: 'workspace';
  /** Filter by member type within the workspace */
  userType: 'bot' | 'user' | 'all';
}

/** Discriminated union for identity descriptors in privileges and createdBy */
export type DocumentIdentity = UserIdentity | BotIdentity | WorkspaceIdentity;

/** Access control entry for a document */
export interface DocumentPrivilege {
  identity: DocumentIdentity;
  role: 'owner' | 'editor' | 'suggester' | 'viewer';
}

// ── Table ────────────────────────────────────────────────────────────

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().notNull(),

    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),

    /** Document category: 'task_instruction' | 'bot_notes' | ... */
    documentType: varchar('document_type', { length: 64 }).notNull(),

    title: varchar('title', { length: 500 }),

    /** ACL: array of { identity, role } */
    privileges: jsonb('privileges')
      .$type<DocumentPrivilege[]>()
      .default([])
      .notNull(),

    /** Denormalized pointer to the latest version for fast reads */
    currentVersionId: uuid('current_version_id'),

    /** Who created this document */
    createdBy: jsonb('created_by').$type<DocumentIdentity>().notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_documents_tenant_id').on(table.tenantId),
    index('idx_documents_document_type').on(table.documentType),
  ],
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
