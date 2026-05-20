import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  unique,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { tenants } from '../tenant/tenants.js';
import { bots } from '../im/bots.js';
import { users } from '../im/users.js';
import { routines } from '../routine/routines.js';
import { routineTriggers } from '../routine/routine-triggers.js';
import { channels } from '../im/channels.js';
import { documentVersions } from '../document/document-versions.js';
import type {
  ExecutionError,
  TriggerContext,
} from '../routine/routine-executions.js';

// ── Enums ───────────────────────────────────────────────────────────

export const taskRunStatusEnum = pgEnum('task__run_status', [
  'draft',
  'upcoming',
  'in_progress',
  'paused',
  'pending_action',
  'completed',
  'failed',
  'stopped',
  'timeout',
]);

// ── Table ───────────────────────────────────────────────────────────

export const taskRuns = pgTable(
  'task__runs',
  {
    id: uuid('id').primaryKey().notNull(),

    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),

    /**
     * Optional source routine. Independent task runs keep this null and
     * therefore never provision or depend on a routine folder9 folder.
     */
    routineId: uuid('routine_id').references(() => routines.id, {
      onDelete: 'set null',
    }),
    routineVersion: integer('routine_version'),

    botId: uuid('bot_id').references(() => bots.id, { onDelete: 'set null' }),

    creatorId: uuid('creator_id')
      .references(() => users.id)
      .notNull(),

    title: varchar('title', { length: 500 }).notNull(),
    description: text('description'),

    status: taskRunStatusEnum('status').default('upcoming').notNull(),

    channelId: uuid('channel_id').references(() => channels.id, {
      onDelete: 'set null',
    }),

    taskcastTaskId: varchar('taskcast_task_id', { length: 128 }),

    tokenUsage: integer('token_usage').default(0).notNull(),

    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    duration: integer('duration'),

    error: jsonb('error').$type<ExecutionError>(),

    triggerId: uuid('trigger_id').references(() => routineTriggers.id, {
      onDelete: 'set null',
    }),
    triggerType: varchar('trigger_type', { length: 32 }),
    triggerContext: jsonb('trigger_context').$type<TriggerContext>(),
    documentVersionId: uuid('document_version_id').references(
      () => documentVersions.id,
      { onDelete: 'set null' },
    ),
    sourceRunId: uuid('source_run_id'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_task__runs_tenant_id').on(table.tenantId),
    index('idx_task__runs_routine_id').on(table.routineId),
    index('idx_task__runs_bot_id').on(table.botId),
    index('idx_task__runs_creator_id').on(table.creatorId),
    index('idx_task__runs_channel_id').on(table.channelId),
    index('idx_task__runs_status').on(table.status),
    index('idx_task__runs_tenant_status').on(table.tenantId, table.status),
    unique('uq_task__runs_taskcast').on(table.taskcastTaskId),
  ],
);

export type TaskRun = typeof taskRuns.$inferSelect;
export type NewTaskRun = typeof taskRuns.$inferInsert;
export type TaskRunStatus = (typeof taskRunStatusEnum.enumValues)[number];
