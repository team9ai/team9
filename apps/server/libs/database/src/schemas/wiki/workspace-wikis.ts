import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from '../tenant/tenants.js';

export const wikiApprovalModeEnum = pgEnum('wiki_approval_mode', [
  'auto',
  'review',
]);

export const wikiPermissionLevelEnum = pgEnum('wiki_permission_level', [
  'read',
  'propose',
  'write',
]);

export const workspaceWikis = pgTable(
  'workspace_wikis',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Matches the convention in im/channels.ts, im/notifications.ts, etc.:
    // workspace_id is a uuid with an ON DELETE CASCADE FK to tenants.id so
    // purging a tenant automatically cleans up its wikis (the folder9 folder
    // is NOT cascaded — deleting a tenant is rare enough that any orphan
    // folders should be reaped by a separate housekeeping job if needed).
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    folder9FolderId: uuid('folder9_folder_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    icon: text('icon'),
    approvalMode: wikiApprovalModeEnum('approval_mode')
      .default('auto')
      .notNull(),
    humanPermission: wikiPermissionLevelEnum('human_permission')
      .default('write')
      .notNull(),
    agentPermission: wikiPermissionLevelEnum('agent_permission')
      .default('read')
      .notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    archivedAt: timestamp('archived_at'),
  },
  (table) => [
    uniqueIndex('workspace_wikis_workspace_slug_unique').on(
      table.workspaceId,
      table.slug,
    ),
    uniqueIndex('workspace_wikis_folder9_unique').on(table.folder9FolderId),
    index('workspace_wikis_workspace_idx').on(table.workspaceId),
  ],
);

export type WorkspaceWiki = typeof workspaceWikis.$inferSelect;
export type NewWorkspaceWiki = typeof workspaceWikis.$inferInsert;
