/**
 * Task Lifecycle Types
 * Type definitions for task lifecycle management
 */

import type { BaseEvent } from '../../../types/base-event.types.js';

// ============ Event Types ============

/**
 * Task lifecycle event type enum values for this component
 */
export const TaskLifecycleEventType = {
  TASK_COMPLETED: 'TASK_COMPLETED',
  TASK_ABANDONED: 'TASK_ABANDONED',
  TASK_TERMINATED: 'TASK_TERMINATED',
} as const;

export type TaskLifecycleEventTypeValue =
  (typeof TaskLifecycleEventType)[keyof typeof TaskLifecycleEventType];

// ============ Event Interfaces ============

export interface TaskCompletedEvent extends BaseEvent<
  typeof TaskLifecycleEventType.TASK_COMPLETED
> {
  /** Completion result */
  result: unknown;
  /** Summary of what was done */
  summary?: string;
}

export interface TaskAbandonedEvent extends BaseEvent<
  typeof TaskLifecycleEventType.TASK_ABANDONED
> {
  /** Reason for abandonment */
  reason: string;
  /** Partial progress if any */
  partialResult?: unknown;
}

export interface TaskTerminatedEvent extends BaseEvent<
  typeof TaskLifecycleEventType.TASK_TERMINATED
> {
  /** Who terminated (user/system/parent) */
  terminatedBy: 'user' | 'system' | 'parent';
  /** Reason for termination */
  reason?: string;
}

/** Union of all task lifecycle events */
export type TaskLifecycleEvent =
  | TaskCompletedEvent
  | TaskAbandonedEvent
  | TaskTerminatedEvent;

// ============ Component Types ============

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
