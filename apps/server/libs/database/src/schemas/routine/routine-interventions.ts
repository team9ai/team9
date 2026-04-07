import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { routineExecutions } from './routine-executions.js';
import { routines } from './routines.js';
import { routineSteps } from './routine-steps.js';
import { users } from '../im/users.js';

// ── Enums ───────────────────────────────────────────────────────────

export const routineInterventionStatusEnum = pgEnum(
  'routine__intervention_status',
  ['pending', 'resolved', 'expired'],
);

// ── Types ───────────────────────────────────────────────────────────

export interface InterventionAction {
  label: string;
  value: string;
}

export interface InterventionResponse {
  action: string;
  message?: string;
}

// ── Table ───────────────────────────────────────────────────────────

export const routineInterventions = pgTable(
  'routine__interventions',
  {
    id: uuid('id').primaryKey().notNull(),

    executionId: uuid('execution_id')
      .references(() => routineExecutions.id, { onDelete: 'cascade' })
      .notNull(),

    routineId: uuid('routine_id')
      .references(() => routines.id, { onDelete: 'cascade' })
      .notNull(),

    stepId: uuid('step_id').references(() => routineSteps.id),

    prompt: text('prompt').notNull(),

    actions: jsonb('actions').$type<InterventionAction[]>().notNull(),

    response: jsonb('response').$type<InterventionResponse>(),

    status: routineInterventionStatusEnum('status')
      .default('pending')
      .notNull(),

    resolvedBy: uuid('resolved_by').references(() => users.id),

    resolvedAt: timestamp('resolved_at'),

    expiresAt: timestamp('expires_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_routine__interventions_execution_id').on(table.executionId),
    index('idx_routine__interventions_routine_id').on(table.routineId),
    index('idx_routine__interventions_status').on(table.status),
  ],
);

export type RoutineIntervention = typeof routineInterventions.$inferSelect;
export type NewRoutineIntervention = typeof routineInterventions.$inferInsert;
export type RoutineInterventionStatus =
  (typeof routineInterventionStatusEnum.enumValues)[number];
