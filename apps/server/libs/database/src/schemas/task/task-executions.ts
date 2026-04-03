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
import { agentTaskTriggers } from './task-triggers.js';
import { channels } from '../im/channels.js';
import { documentVersions } from '../document/document-versions.js';

// ── Types ───────────────────────────────────────────────────────────

export interface ManualTriggerContext {
  triggeredAt: string;
  triggeredBy: string;
  notes?: string;
}

export interface ScheduleTriggerContext {
  triggeredAt: string;
  scheduledAt: string;
}

export interface ChannelMessageTriggerContext {
  triggeredAt: string;
  channelId: string;
  messageId: string;
  messageContent?: string;
  messageType?: 'text' | 'file' | 'image' | 'system' | 'tracking';
  senderId: string;
  senderUserType?: 'human' | 'bot' | 'system' | null;
  senderAgentType?: 'base_model' | 'openclaw' | null;
}

export interface RetryTriggerContext {
  triggeredAt: string;
  triggeredBy: string;
  notes?: string;
  originalExecutionId: string;
  originalFailReason?: string;
}

export type TriggerContext =
  | ManualTriggerContext
  | ScheduleTriggerContext
  | ChannelMessageTriggerContext
  | RetryTriggerContext;

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

    taskVersion: integer('task_version').notNull(),

    status: agentTaskStatusEnum('status').default('in_progress').notNull(),

    channelId: uuid('channel_id').references(() => channels.id),

    taskcastTaskId: varchar('taskcast_task_id', { length: 128 }),

    tokenUsage: integer('token_usage').default(0).notNull(),

    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    duration: integer('duration'),

    error: jsonb('error').$type<ExecutionError>(),

    triggerId: uuid('trigger_id').references(() => agentTaskTriggers.id),
    triggerType: varchar('trigger_type', { length: 32 }),
    triggerContext: jsonb('trigger_context').$type<TriggerContext>(),
    documentVersionId: uuid('document_version_id').references(
      () => documentVersions.id,
    ),
    sourceExecutionId: uuid('source_execution_id'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_agent_task__executions_task_id').on(table.taskId),
    index('idx_agent_task__executions_status').on(table.status),
    index('idx_agent_task__executions_task_version').on(
      table.taskId,
      table.taskVersion,
    ),
    unique('uq_agent_task__executions_taskcast').on(table.taskcastTaskId),
  ],
);

export type AgentTaskExecution = typeof agentTaskExecutions.$inferSelect;
export type NewAgentTaskExecution = typeof agentTaskExecutions.$inferInsert;
