import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { tenants } from '../tenant/tenants.js';
import { bots } from '../im/bots.js';
import { users } from '../im/users.js';
import { documents } from '../document/documents.js';

// ── Enums ───────────────────────────────────────────────────────────

export const routineStatusEnum = pgEnum('routine__status', [
  'upcoming',
  'in_progress',
  'paused',
  'pending_action',
  'completed',
  'failed',
  'stopped',
  'timeout',
]);

export const routineScheduleTypeEnum = pgEnum('routine__schedule_type', [
  'once',
  'recurring',
]);

// ── Types ───────────────────────────────────────────────────────────

export interface ScheduleConfig {
  frequency?: string;
  time?: string;
  timezone?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  cron?: string;
}

// ── Table ───────────────────────────────────────────────────────────

export const routines = pgTable(
  'routine__routines',
  {
    id: uuid('id').primaryKey().notNull(),

    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),

    botId: uuid('bot_id').references(() => bots.id, { onDelete: 'cascade' }),

    creatorId: uuid('creator_id')
      .references(() => users.id)
      .notNull(),

    title: varchar('title', { length: 500 }).notNull(),
    description: text('description'),

    status: routineStatusEnum('status').default('upcoming').notNull(),
    /** @deprecated Use routine__triggers table instead */
    scheduleType: routineScheduleTypeEnum('schedule_type')
      .default('once')
      .notNull(),
    /** @deprecated Use routine__triggers table instead */
    scheduleConfig: jsonb('schedule_config').$type<ScheduleConfig>(),
    /** @deprecated Use routine__triggers.next_run_at instead */
    nextRunAt: timestamp('next_run_at'),

    version: integer('version').default(1).notNull(),

    documentId: uuid('document_id').references(() => documents.id),

    // Forward reference — FK to routine__executions added via relations
    currentExecutionId: uuid('current_execution_id'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_routine__routines_tenant_id').on(table.tenantId),
    index('idx_routine__routines_bot_id').on(table.botId),
    index('idx_routine__routines_creator_id').on(table.creatorId),
    index('idx_routine__routines_status').on(table.status),
    index('idx_routine__routines_next_run_at').on(table.nextRunAt),
    index('idx_routine__routines_tenant_status').on(
      table.tenantId,
      table.status,
    ),
  ],
);

export type Routine = typeof routines.$inferSelect;
export type NewRoutine = typeof routines.$inferInsert;
export type RoutineStatus = (typeof routineStatusEnum.enumValues)[number];
export type RoutineScheduleType =
  (typeof routineScheduleTypeEnum.enumValues)[number];
