import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { agentTaskExecutions } from './task-executions.js';
import { agentTasks } from './tasks.js';

// ── Enums ───────────────────────────────────────────────────────────

export const agentTaskStepStatusEnum = pgEnum('agent_task__step_status', [
  'pending',
  'in_progress',
  'completed',
  'failed',
]);

// ── Table ───────────────────────────────────────────────────────────

export const agentTaskSteps = pgTable(
  'agent_task__steps',
  {
    id: uuid('id').primaryKey().notNull(),

    executionId: uuid('execution_id')
      .references(() => agentTaskExecutions.id, { onDelete: 'cascade' })
      .notNull(),

    taskId: uuid('task_id')
      .references(() => agentTasks.id, { onDelete: 'cascade' })
      .notNull(),

    orderIndex: integer('order_index').notNull(),

    title: varchar('title', { length: 500 }).notNull(),

    status: agentTaskStepStatusEnum('status').default('pending').notNull(),

    tokenUsage: integer('token_usage').default(0).notNull(),

    duration: integer('duration'),

    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_agent_task__steps_execution_id').on(table.executionId),
    index('idx_agent_task__steps_task_id').on(table.taskId),
  ],
);

export type AgentTaskStep = typeof agentTaskSteps.$inferSelect;
export type NewAgentTaskStep = typeof agentTaskSteps.$inferInsert;
export type AgentTaskStepStatus =
  (typeof agentTaskStepStatusEnum.enumValues)[number];
