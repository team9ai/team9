import {
  pgTable,
  uuid,
  varchar,
  text,
  bigint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { routineExecutions } from './routine-executions.js';
import { routines } from './routines.js';

// ── Table ───────────────────────────────────────────────────────────

export const routineDeliverables = pgTable(
  'routine__deliverables',
  {
    id: uuid('id').primaryKey().notNull(),

    executionId: uuid('execution_id')
      .references(() => routineExecutions.id, { onDelete: 'cascade' })
      .notNull(),

    routineId: uuid('routine_id')
      .references(() => routines.id, { onDelete: 'cascade' })
      .notNull(),

    fileName: varchar('file_name', { length: 500 }).notNull(),

    fileSize: bigint('file_size', { mode: 'number' }),

    mimeType: varchar('mime_type', { length: 128 }),

    fileUrl: text('file_url').notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_routine__deliverables_execution_id').on(table.executionId),
    index('idx_routine__deliverables_routine_id').on(table.routineId),
  ],
);

export type RoutineDeliverable = typeof routineDeliverables.$inferSelect;
export type NewRoutineDeliverable = typeof routineDeliverables.$inferInsert;
