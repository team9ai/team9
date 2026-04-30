import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from '../tenant/tenants.js';

/**
 * Idempotent registry of Folder9 folders per (workspace, scope, scopeId,
 * mountKey). Backs the `JustBashTeam9WorkspaceComponent` virtual workspace
 * mount layer.
 *
 * Lazy-provisioned by `FolderMountResolver`: SELECT first; on miss, create
 * via `Folder9ClientService.createFolder` and INSERT ... ON CONFLICT DO
 * NOTHING (race-safe). The unique constraint on
 * (workspace_id, scope, scope_id, mount_key) is the idempotency guard.
 */
export const workspaceFolderMounts = pgTable(
  'workspace_folder_mounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    /** 'session' | 'agent' | 'routine' | 'user' */
    scope: varchar('scope', { length: 32 }).notNull(),
    /** sessionId / botId / routineId / userId */
    scopeId: varchar('scope_id', { length: 256 }).notNull(),
    /** 'tmp' | 'home' | 'document' (room for future) */
    mountKey: varchar('mount_key', { length: 32 }).notNull(),
    /** 'light' | 'managed' — denormalized so subsequent operations don't
     * need to round-trip Folder9 to learn the type. */
    folderType: varchar('folder_type', { length: 16 }).notNull(),
    /** UUID returned by Folder9 createFolder. Source of truth. */
    folder9FolderId: uuid('folder9_folder_id').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // The unique constraint serves both the idempotency guard for
    // INSERT ... ON CONFLICT DO NOTHING AND the lookup path for
    // FolderMountResolver's SELECT — Postgres' planner picks this
    // index for any prefix lookup on (workspace_id, scope, scope_id,
    // mount_key), so a separate non-unique lookup index would be
    // redundant write overhead.
    uniqueIndex('workspace_folder_mounts_unique').on(
      table.workspaceId,
      table.scope,
      table.scopeId,
      table.mountKey,
    ),
  ],
);

export type WorkspaceFolderMount = typeof workspaceFolderMounts.$inferSelect;
export type NewWorkspaceFolderMount = typeof workspaceFolderMounts.$inferInsert;
