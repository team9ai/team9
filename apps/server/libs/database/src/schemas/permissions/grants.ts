import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from '../tenant/tenants.js';
import { users } from '../im/users.js';
import { authPermissionRequests } from './requests.js';

export const permissionSubjectKindEnum = pgEnum('permission_subject_kind', [
  'agent',
  'channel-session',
  'execution-session',
  'task',
]);

export const permissionGrantSourceEnum = pgEnum('permission_grant_source', [
  'proactive',
  'request_approved',
]);

export const authPermissionGrants = pgTable(
  'auth_permission_grants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    grantedByUserId: uuid('granted_by_user_id')
      .notNull()
      .references(() => users.id),
    subjectKind: permissionSubjectKindEnum('subject_kind').notNull(),
    subjectId: uuid('subject_id').notNull(),
    permissionKey: text('permission_key').notNull(),
    scopeMetadata: jsonb('scope_metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    source: permissionGrantSourceEnum('source').notNull(),
    requestId: uuid('request_id').references(() => authPermissionRequests.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: uuid('revoked_by_user_id').references(() => users.id),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('auth_grants_subject_idx').on(
      t.tenantId,
      t.subjectKind,
      t.subjectId,
      t.permissionKey,
    ),
    index('auth_grants_active_idx')
      .on(t.tenantId, t.permissionKey)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);

export type AuthPermissionGrant = typeof authPermissionGrants.$inferSelect;
export type AuthPermissionGrantInsert =
  typeof authPermissionGrants.$inferInsert;
