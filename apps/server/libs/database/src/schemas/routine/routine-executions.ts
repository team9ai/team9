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
import { routines, routineStatusEnum } from './routines.js';
import { routineTriggers } from './routine-triggers.js';
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

export const routineExecutions = pgTable(
  'routine__executions',
  {
    id: uuid('id').primaryKey().notNull(),

    routineId: uuid('routine_id')
      .references(() => routines.id, { onDelete: 'cascade' })
      .notNull(),

    routineVersion: integer('routine_version').notNull(),

    status: routineStatusEnum('status').default('in_progress').notNull(),

    channelId: uuid('channel_id').references(() => channels.id),

    taskcastTaskId: varchar('taskcast_task_id', { length: 128 }),

    tokenUsage: integer('token_usage').default(0).notNull(),

    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    duration: integer('duration'),

    error: jsonb('error').$type<ExecutionError>(),

    triggerId: uuid('trigger_id').references(() => routineTriggers.id),
    triggerType: varchar('trigger_type', { length: 32 }),
    triggerContext: jsonb('trigger_context').$type<TriggerContext>(),
    documentVersionId: uuid('document_version_id').references(
      () => documentVersions.id,
    ),
    sourceExecutionId: uuid('source_execution_id'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_routine__executions_routine_id').on(table.routineId),
    index('idx_routine__executions_status').on(table.status),
    index('idx_routine__executions_routine_version').on(
      table.routineId,
      table.routineVersion,
    ),
    unique('uq_routine__executions_taskcast').on(table.taskcastTaskId),
  ],
);

export type RoutineExecution = typeof routineExecutions.$inferSelect;
export type NewRoutineExecution = typeof routineExecutions.$inferInsert;
