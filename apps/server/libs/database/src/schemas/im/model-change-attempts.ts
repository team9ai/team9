import {
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { channels } from './channels.js';
import { bots } from './bots.js';
import { installedApplications } from './installed-applications.js';

export const modelChangeDecisionEnum = pgEnum('model_change_decision', [
  'accepted',
  'rejected',
]);

export const modelChangeDispatchStatusEnum = pgEnum(
  'model_change_dispatch_status',
  ['not_applicable', 'pending', 'dispatching', 'dispatched', 'failed'],
);

export const modelChangeAttempts = pgTable(
  'im_model_change_attempts',
  {
    id: uuid('id').primaryKey().notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),

    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    authSessionId: varchar('auth_session_id', { length: 128 }),
    correlationId: varchar('correlation_id', { length: 128 }),
    tenantId: uuid('tenant_id'),
    channelId: uuid('channel_id').references(() => channels.id, {
      onDelete: 'set null',
    }),
    botId: uuid('bot_id').references(() => bots.id, {
      onDelete: 'set null',
    }),
    // Durable event identity: intentionally no FK/ON DELETE action. If the
    // bot user is removed after Hive dispatch but before websocket repair,
    // the outbox must retain the original recipient identity.
    botUserId: uuid('bot_user_id'),
    installedApplicationId: uuid('installed_application_id').references(
      () => installedApplications.id,
      { onDelete: 'set null' },
    ),
    applicationId: varchar('application_id', { length: 255 }),
    sessionId: varchar('session_id', { length: 512 }),

    requestedProvider: varchar('requested_provider', { length: 128 }).notNull(),
    requestedModelId: varchar('requested_model_id', { length: 256 }).notNull(),
    capability: varchar('capability', { length: 64 }),
    catalogVersion: varchar('catalog_version', { length: 64 }),

    decision: modelChangeDecisionEnum('decision').notNull(),
    reasonCode: varchar('reason_code', { length: 64 }).notNull(),
    dispatchStatus: modelChangeDispatchStatusEnum('dispatch_status').notNull(),
    safeErrorCode: varchar('safe_error_code', { length: 128 }),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    dispatchedAt: timestamp('dispatched_at'),
  },
  (table) => [
    uniqueIndex('uq_model_change_attempts_idempotency').on(
      table.idempotencyKey,
    ),
    index('idx_model_change_attempts_actor_created').on(
      table.actorUserId,
      table.createdAt,
    ),
    index('idx_model_change_attempts_tenant_created').on(
      table.tenantId,
      table.createdAt,
    ),
    index('idx_model_change_attempts_decision_reason').on(
      table.decision,
      table.reasonCode,
    ),
  ],
);

export type ModelChangeAttempt = typeof modelChangeAttempts.$inferSelect;
export type NewModelChangeAttempt = typeof modelChangeAttempts.$inferInsert;
