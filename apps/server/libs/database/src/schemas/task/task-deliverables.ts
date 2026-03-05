import {
  pgTable,
  uuid,
  varchar,
  text,
  bigint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { agentTaskExecutions } from './task-executions.js';
import { agentTasks } from './tasks.js';

// ── Table ───────────────────────────────────────────────────────────

export const agentTaskDeliverables = pgTable(
  'agent_task__deliverables',
  {
    id: uuid('id').primaryKey().notNull(),

    executionId: uuid('execution_id')
      .references(() => agentTaskExecutions.id, { onDelete: 'cascade' })
      .notNull(),

    taskId: uuid('task_id')
      .references(() => agentTasks.id, { onDelete: 'cascade' })
      .notNull(),

    fileName: varchar('file_name', { length: 500 }).notNull(),

    fileSize: bigint('file_size', { mode: 'number' }),

    mimeType: varchar('mime_type', { length: 128 }),

    fileUrl: text('file_url').notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_agent_task__deliverables_execution_id').on(table.executionId),
    index('idx_agent_task__deliverables_task_id').on(table.taskId),
  ],
);

export type AgentTaskDeliverable = typeof agentTaskDeliverables.$inferSelect;
export type NewAgentTaskDeliverable = typeof agentTaskDeliverables.$inferInsert;
