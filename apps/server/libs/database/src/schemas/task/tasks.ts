import {
  pgTable,
  uuid,
  varchar,
  text,
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

export const agentTaskStatusEnum = pgEnum('agent_task__status', [
  'upcoming',
  'in_progress',
  'paused',
  'pending_action',
  'completed',
  'failed',
  'stopped',
  'timeout',
]);

export const agentTaskScheduleTypeEnum = pgEnum('agent_task__schedule_type', [
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

export const agentTasks = pgTable(
  'agent_task__tasks',
  {
    id: uuid('id').primaryKey().notNull(),

    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),

    botId: uuid('bot_id')
      .references(() => bots.id, { onDelete: 'cascade' })
      .notNull(),

    creatorId: uuid('creator_id')
      .references(() => users.id)
      .notNull(),

    title: varchar('title', { length: 500 }).notNull(),
    description: text('description'),

    status: agentTaskStatusEnum('status').default('upcoming').notNull(),
    scheduleType: agentTaskScheduleTypeEnum('schedule_type')
      .default('once')
      .notNull(),
    scheduleConfig: jsonb('schedule_config').$type<ScheduleConfig>(),

    nextRunAt: timestamp('next_run_at'),

    documentId: uuid('document_id').references(() => documents.id),

    // Forward reference — FK to agent_task__executions added via relations
    currentExecutionId: uuid('current_execution_id'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_agent_task__tasks_tenant_id').on(table.tenantId),
    index('idx_agent_task__tasks_bot_id').on(table.botId),
    index('idx_agent_task__tasks_creator_id').on(table.creatorId),
    index('idx_agent_task__tasks_status').on(table.status),
    index('idx_agent_task__tasks_next_run_at').on(table.nextRunAt),
    index('idx_agent_task__tasks_tenant_status').on(
      table.tenantId,
      table.status,
    ),
  ],
);

export type AgentTask = typeof agentTasks.$inferSelect;
export type NewAgentTask = typeof agentTasks.$inferInsert;
export type AgentTaskStatus = (typeof agentTaskStatusEnum.enumValues)[number];
export type AgentTaskScheduleType =
  (typeof agentTaskScheduleTypeEnum.enumValues)[number];
