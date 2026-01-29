import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
  integer,
  pgEnum,
} from 'drizzle-orm/pg-core';

/**
 * Task status enum for task lifecycle management
 * - pending: Task created, waiting for worker to claim
 * - in_progress: Task claimed by a worker, being processed
 * - completed: Task finished successfully
 * - failed: Task finished with error
 * - timeout: Task exceeded its timeout limit
 */
export const taskStatusEnum = pgEnum('task_status', [
  'pending',
  'in_progress',
  'completed',
  'failed',
  'timeout',
]);

/**
 * Task tracker table for storing long-running task information
 * Supports task registration, progress tracking, worker assignment, and retry
 */
export const tasks = pgTable(
  'tracker_tasks',
  {
    // Primary key - can be auto-generated or provided by client
    id: varchar('id', { length: 64 }).primaryKey(),

    // Task type for worker filtering (e.g., 'ai_inference', 'video_encode')
    taskType: varchar('task_type', { length: 128 }).notNull(),

    // Current task status
    status: taskStatusEnum('status').default('pending').notNull(),

    // Initial parameters/metadata provided when task is registered
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    // Task execution parameters (passed to worker)
    params: jsonb('params').$type<Record<string, unknown>>(),

    // Result data when task completes successfully
    result: jsonb('result').$type<Record<string, unknown>>(),

    // Error details when task fails
    error: jsonb('error').$type<Record<string, unknown>>(),

    // Complete progress history (persisted from Redis when task ends)
    progressHistory:
      jsonb('progress_history').$type<
        Array<{ seqId: number; [key: string]: unknown }>
      >(),

    // Timeout in seconds (default 24 hours = 86400 seconds)
    timeoutSeconds: integer('timeout_seconds').default(86400).notNull(),

    // Worker currently processing this task
    workerId: varchar('worker_id', { length: 128 }),

    // Original task ID for retry tracking
    originalTaskId: varchar('original_task_id', { length: 64 }),

    // Retry count
    retryCount: integer('retry_count').default(0).notNull(),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    timeoutAt: timestamp('timeout_at'),
  },
  (table) => [
    // Index for filtering tasks by type (for worker claiming)
    index('idx_tasks_task_type').on(table.taskType),
    // Index for filtering by status (pending tasks for claiming)
    index('idx_tasks_status').on(table.status),
    // Composite index for worker claiming (type + status)
    index('idx_tasks_type_status').on(table.taskType, table.status),
    // Index for worker lookup
    index('idx_tasks_worker_id').on(table.workerId),
    // Index for timeout detection
    index('idx_tasks_timeout_at').on(table.timeoutAt),
    // Index for retry tracking
    index('idx_tasks_original_task_id').on(table.originalTaskId),
  ],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];
