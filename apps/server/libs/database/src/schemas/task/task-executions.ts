import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  jsonb,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { agentTasks, agentTaskStatusEnum } from './tasks.js';
import { channels } from '../im/channels.js';

// ── Types ───────────────────────────────────────────────────────────

export interface ExecutionError {
  code?: string;
  message: string;
  details?: unknown;
}

// ── Table ───────────────────────────────────────────────────────────

export const agentTaskExecutions = pgTable(
  'agent_task__executions',
  {
    id: uuid('id').primaryKey().notNull(),

    taskId: uuid('task_id')
      .references(() => agentTasks.id, { onDelete: 'cascade' })
      .notNull(),

    version: integer('version').notNull(),

    status: agentTaskStatusEnum('status').default('in_progress').notNull(),

    channelId: uuid('channel_id').references(() => channels.id),

    taskcastTaskId: varchar('taskcast_task_id', { length: 128 }),

    tokenUsage: integer('token_usage').default(0).notNull(),

    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    duration: integer('duration'),

    error: jsonb('error').$type<ExecutionError>(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_agent_task__executions_task_id').on(table.taskId),
    index('idx_agent_task__executions_status').on(table.status),
    index('idx_agent_task__executions_task_version').on(
      table.taskId,
      table.version,
    ),
    unique('uq_agent_task__executions_taskcast').on(table.taskcastTaskId),
  ],
);

export type AgentTaskExecution = typeof agentTaskExecutions.$inferSelect;
export type NewAgentTaskExecution = typeof agentTaskExecutions.$inferInsert;
