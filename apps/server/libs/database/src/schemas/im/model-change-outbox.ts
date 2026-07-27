import {
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { modelChangeAttempts } from './model-change-attempts.js';

export const modelChangeOutboxStatusEnum = pgEnum(
  'model_change_outbox_status',
  ['pending', 'processing', 'dispatched', 'failed'],
);

export const modelChangeOutbox = pgTable(
  'im_model_change_outbox',
  {
    id: uuid('id').primaryKey().notNull(),
    attemptId: uuid('attempt_id')
      .references(() => modelChangeAttempts.id, { onDelete: 'cascade' })
      .notNull(),
    status: modelChangeOutboxStatusEnum('status').default('pending').notNull(),
    retryCount: integer('retry_count').default(0).notNull(),
    nextAttemptAt: timestamp('next_attempt_at').defaultNow().notNull(),
    claimToken: uuid('claim_token'),
    claimUntil: timestamp('claim_until'),
    safeErrorCode: varchar('safe_error_code', { length: 128 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_model_change_outbox_attempt').on(table.attemptId),
    index('idx_model_change_outbox_due').on(table.status, table.nextAttemptAt),
    index('idx_model_change_outbox_claim').on(table.status, table.claimUntil),
  ],
);

export type ModelChangeOutbox = typeof modelChangeOutbox.$inferSelect;
export type NewModelChangeOutbox = typeof modelChangeOutbox.$inferInsert;
