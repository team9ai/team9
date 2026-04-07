/**
 * Routine WebSocket event type definitions
 *
 * Events for routine execution lifecycle including status changes
 * and new execution creation.
 *
 * @module events/domains/routine
 */

// ==================== Routine Events ====================

/**
 * Routine status changed event
 *
 * Sent by the server when a routine execution's status changes
 * (e.g., from 'running' to 'completed').
 *
 * @event routine:status_changed
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('routine:status_changed', (event: RoutineStatusChangedEvent) => {
 *   // Invalidate routine queries to refresh UI
 *   queryClient.invalidateQueries({ queryKey: ['routines'] });
 *   queryClient.invalidateQueries({ queryKey: ['routine', event.routineId] });
 * });
 * ```
 */
export interface RoutineStatusChangedEvent {
  /** Routine ID */
  routineId: string;
  /** Execution ID */
  executionId: string;
  /** New status */
  status: string;
  /** Previous status */
  previousStatus: string;
}

/**
 * Routine execution created event
 *
 * Sent by the server when a new execution is created for a routine.
 *
 * @event routine:execution_created
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('routine:execution_created', (event: RoutineExecutionCreatedEvent) => {
 *   // Invalidate routine queries to refresh UI
 *   queryClient.invalidateQueries({ queryKey: ['routines'] });
 *   queryClient.invalidateQueries({ queryKey: ['routine', event.routineId] });
 * });
 * ```
 */
export interface RoutineExecutionCreatedEvent {
  /** Routine ID */
  routineId: string;
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
