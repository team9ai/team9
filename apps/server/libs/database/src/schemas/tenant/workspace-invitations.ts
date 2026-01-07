import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  boolean,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from '../im/users.js';
import { tenantRoleEnum } from './tenant-members.js';

export const workspaceInvitations = pgTable('workspace_invitations', {
  id: uuid('id').primaryKey().notNull(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' })
    .notNull(),
  code: varchar('code', { length: 32 }).unique().notNull(),
  createdBy: uuid('created_by').references(() => users.id, {
    onDelete: 'set null',
  }),
  role: tenantRoleEnum('role').default('member').notNull(),
  maxUses: integer('max_uses'), // null = unlimited
  usedCount: integer('used_count').default(0).notNull(),
  expiresAt: timestamp('expires_at'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const invitationUsage = pgTable('invitation_usage', {
  id: uuid('id').primaryKey().notNull(),
  invitationId: uuid('invitation_id')
    .references(() => workspaceInvitations.id, { onDelete: 'cascade' })
    .notNull(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  usedAt: timestamp('used_at').defaultNow().notNull(),
});

export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect;
export type NewWorkspaceInvitation = typeof workspaceInvitations.$inferInsert;
export type InvitationUsage = typeof invitationUsage.$inferSelect;
export type NewInvitationUsage = typeof invitationUsage.$inferInsert;
