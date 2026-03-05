import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { agentTaskExecutions } from './task-executions.js';
import { agentTasks } from './tasks.js';
import { agentTaskSteps } from './task-steps.js';
import { users } from '../im/users.js';

// ── Enums ───────────────────────────────────────────────────────────

export const agentTaskInterventionStatusEnum = pgEnum(
  'agent_task__intervention_status',
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

export const agentTaskInterventions = pgTable(
  'agent_task__interventions',
  {
    id: uuid('id').primaryKey().notNull(),

    executionId: uuid('execution_id')
      .references(() => agentTaskExecutions.id, { onDelete: 'cascade' })
      .notNull(),

    taskId: uuid('task_id')
      .references(() => agentTasks.id, { onDelete: 'cascade' })
      .notNull(),

    stepId: uuid('step_id').references(() => agentTaskSteps.id),

    prompt: text('prompt').notNull(),

    actions: jsonb('actions').$type<InterventionAction[]>().notNull(),

    response: jsonb('response').$type<InterventionResponse>(),

    status: agentTaskInterventionStatusEnum('status')
      .default('pending')
      .notNull(),

    resolvedBy: uuid('resolved_by').references(() => users.id),

    resolvedAt: timestamp('resolved_at'),

    expiresAt: timestamp('expires_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_agent_task__interventions_execution_id').on(table.executionId),
    index('idx_agent_task__interventions_task_id').on(table.taskId),
    index('idx_agent_task__interventions_status').on(table.status),
  ],
);

export type AgentTaskIntervention = typeof agentTaskInterventions.$inferSelect;
export type NewAgentTaskIntervention =
  typeof agentTaskInterventions.$inferInsert;
export type AgentTaskInterventionStatus =
  (typeof agentTaskInterventionStatusEnum.enumValues)[number];
