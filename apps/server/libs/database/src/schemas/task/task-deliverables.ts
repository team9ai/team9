import {
  pgTable,
  uuid,
  varchar,
  text,
  bigint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { taskRuns } from './task-runs.js';
import { routines } from '../routine/routines.js';

// ── Table ───────────────────────────────────────────────────────────

export const taskDeliverables = pgTable(
  'task__deliverables',
  {
    id: uuid('id').primaryKey().notNull(),

    runId: uuid('run_id')
      .references(() => taskRuns.id, { onDelete: 'cascade' })
      .notNull(),

    routineId: uuid('routine_id').references(() => routines.id, {
      onDelete: 'set null',
    }),

    fileName: varchar('file_name', { length: 500 }).notNull(),

    fileSize: bigint('file_size', { mode: 'number' }),

    mimeType: varchar('mime_type', { length: 128 }),

    fileUrl: text('file_url').notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_task__deliverables_run_id').on(table.runId),
    index('idx_task__deliverables_routine_id').on(table.routineId),
  ],
);

export type TaskDeliverable = typeof taskDeliverables.$inferSelect;
export type NewTaskDeliverable = typeof taskDeliverables.$inferInsert;
