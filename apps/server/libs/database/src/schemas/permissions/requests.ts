import { sql } from 'drizzle-orm';
import {
  AnyPgColumn,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from '../tenant/tenants.js';
import { bots } from '../im/bots.js';
import { channels } from '../im/channels.js';
import { users } from '../im/users.js';
import { routineExecutions } from '../routine/routine-executions.js';
import { routines } from '../routine/routines.js';
// Lazy import to avoid circular dependency: grants.ts → requests.ts → grants.ts
import { authPermissionGrants } from './grants.js';

export const permissionRequestStatusEnum = pgEnum('permission_request_status', [
  'pending',
  'approved_once',
  'approved_durable',
  'denied',
  'expired',
  'cancelled',
]);

export const authPermissionRequests = pgTable(
  'auth_permission_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    spellId: text('spell_id').notNull(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    requesterBotId: uuid('requester_bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    contextChannelId: uuid('context_channel_id').references(() => channels.id, {
      onDelete: 'set null',
    }),
    contextExecutionId: uuid('context_execution_id').references(
      () => routineExecutions.id,
      { onDelete: 'set null' },
    ),
    contextRoutineId: uuid('context_routine_id').references(() => routines.id, {
      onDelete: 'set null',
    }),
    permissionKey: text('permission_key').notNull(),
    requestedMetadata: jsonb('requested_metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    suggestedApproverIds: uuid('suggested_approver_ids')
      .array()
      .notNull()
      .default(sql`ARRAY[]::uuid[]`),
    reason: text('reason'),
    status: permissionRequestStatusEnum('status').notNull().default('pending'),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    durableGrantId: uuid('durable_grant_id').references(
      (): AnyPgColumn => authPermissionGrants.id,
      { onDelete: 'set null' },
    ),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('auth_req_spell_idx').on(t.spellId),
    index('auth_req_pending_bot_idx').on(
      t.tenantId,
      t.requesterBotId,
      t.status,
    ),
    index('auth_req_pending_ctx_idx').on(
      t.tenantId,
      t.contextChannelId,
      t.status,
    ),
  ],
);

export type AuthPermissionRequest = typeof authPermissionRequests.$inferSelect;
export type AuthPermissionRequestInsert =
  typeof authPermissionRequests.$inferInsert;
