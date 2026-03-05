/**
 * Task WebSocket event type definitions
 *
 * Events for task execution lifecycle including status changes
 * and new execution creation.
 *
 * @module events/domains/task
 */

// ==================== Task Events ====================

/**
 * Task status changed event
 *
 * Sent by the server when a task execution's status changes
 * (e.g., from 'running' to 'completed').
 *
 * @event task:status_changed
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('task:status_changed', (event: TaskStatusChangedEvent) => {
 *   // Invalidate task queries to refresh UI
 *   queryClient.invalidateQueries({ queryKey: ['tasks'] });
 *   queryClient.invalidateQueries({ queryKey: ['task', event.taskId] });
 * });
 * ```
 */
export interface TaskStatusChangedEvent {
  /** Task ID */
  taskId: string;
  /** Execution ID */
  executionId: string;
  /** New status */
  status: string;
  /** Previous status */
  previousStatus: string;
}

/**
 * Task execution created event
 *
 * Sent by the server when a new execution is created for a task.
 *
 * @event task:execution_created
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('task:execution_created', (event: TaskExecutionCreatedEvent) => {
 *   // Invalidate task queries to refresh UI
 *   queryClient.invalidateQueries({ queryKey: ['tasks'] });
 *   queryClient.invalidateQueries({ queryKey: ['task', event.taskId] });
 * });
 * ```
 */
export interface TaskExecutionCreatedEvent {
  /** Task ID */
  taskId: string;
  /** Execution details */
  execution: {
    /** Execution ID */
    id: string;
    /** Execution version */
    version: number;
    /** Execution status */
    status: string;
    /** Associated channel ID (if any) */
    channelId: string | null;
    /** Taskcast task ID (if any) */
    taskcastTaskId: string | null;
    /** When the execution started (ISO 8601) */
    startedAt: string | null;
    /** When the execution was created (ISO 8601) */
    createdAt: string;
  };
}
