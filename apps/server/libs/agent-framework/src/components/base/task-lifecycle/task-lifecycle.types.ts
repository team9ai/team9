/**
 * Task Lifecycle Types
 * Type definitions for task lifecycle management
 */

/**
 * Task status enum
 */
export type TaskStatus = 'running' | 'completed' | 'abandoned' | 'terminated';

/**
 * Task lifecycle data stored in component
 */
export interface TaskLifecycleData {
  status: TaskStatus;
  startedAt: number;
  endedAt?: number;
  result?: unknown;
  reason?: string;
  terminatedBy?: string;
}
