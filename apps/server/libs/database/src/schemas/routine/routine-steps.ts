import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { routineExecutions } from './routine-executions.js';
import { routines } from './routines.js';

// ── Enums ───────────────────────────────────────────────────────────

export const routineStepStatusEnum = pgEnum('routine__step_status', [
  'pending',
  'in_progress',
  'completed',
  'failed',
]);

// ── Table ───────────────────────────────────────────────────────────

export const routineSteps = pgTable(
  'routine__steps',
  {
    id: uuid('id').primaryKey().notNull(),

    executionId: uuid('execution_id')
      .references(() => routineExecutions.id, { onDelete: 'cascade' })
      .notNull(),

    routineId: uuid('routine_id')
      .references(() => routines.id, { onDelete: 'cascade' })
      .notNull(),

    orderIndex: integer('order_index').notNull(),

    title: varchar('title', { length: 500 }).notNull(),

    status: routineStepStatusEnum('status').default('pending').notNull(),

    tokenUsage: integer('token_usage').default(0).notNull(),

    duration: integer('duration'),

    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_routine__steps_execution_id').on(table.executionId),
    index('idx_routine__steps_routine_id').on(table.routineId),
  ],
);

export type RoutineStep = typeof routineSteps.$inferSelect;
export type NewRoutineStep = typeof routineSteps.$inferInsert;
export type RoutineStepStatus =
  (typeof routineStepStatusEnum.enumValues)[number];
