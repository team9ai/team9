/**
 * Core Event Types
 *
 * This file contains only the core event infrastructure:
 * - BaseEvent interface for all events
 * - Event dispatch strategies
 * - LLM response requirements
 *
 * Component-specific events are defined in their respective component type files:
 * - Error events: components/base/error/error.types.ts
 * - Task lifecycle events: components/base/task-lifecycle/task-lifecycle.types.ts
 * - Working history events: components/base/working-history/working-history.types.ts
 * - Todo events: components/builtin/todo/todo.types.ts
 * - Memory events: components/builtin/memory/memory.types.ts
 */

// Re-export from base-event.types.ts for backward compatibility
export {
  EventDispatchStrategy,
  LLMResponseRequirement,
  type BaseEvent,
} from './base-event.types.js';

// ============ Re-exports from Components (types only) ============
// These re-exports maintain backward compatibility for existing imports
// NOTE: Only types are re-exported to avoid circular dependency issues

// Error component events
export type {
  ToolErrorEvent,
  SubAgentErrorEvent,
  SkillErrorEvent,
  SystemErrorEvent,
  ErrorEvent,
  ErrorEventTypeValue,
} from '../components/base/error/error.types.js';

// Task lifecycle component events
export type {
  TaskCompletedEvent,
  TaskAbandonedEvent,
  TaskTerminatedEvent,
  TaskLifecycleEvent,
  TaskLifecycleEventTypeValue,
} from '../components/base/task-lifecycle/task-lifecycle.types.js';

// Working history component events
export type {
  UserMessageEvent,
  ParentAgentMessageEvent,
  LLMTextResponseEvent,
  LLMToolCallEvent,
  LLMSkillCallEvent,
  LLMSubAgentSpawnEvent,
  LLMSubAgentMessageEvent,
  LLMClarificationEvent,
  ToolResultEvent,
  SkillResultEvent,
  SubAgentResultEvent,
  WorkingHistoryEvent,
  WorkingHistoryEventTypeValue,
} from '../components/base/working-history/working-history.types.js';

// Todo component events
export type {
  TodoItem,
  TodoStatus,
  TodoSetEvent,
  TodoCompletedEvent,
  TodoExpandedEvent,
  TodoUpdatedEvent,
  TodoDeletedEvent,
  TodoEvent,
  TodoEventTypeValue,
} from '../components/builtin/todo/todo.types.js';

// Memory component events
export type {
  MemoryMarkCriticalEvent,
  MemoryForgetEvent,
  MemoryCompactManualEvent,
  MemoryCompactAutoEvent,
  MemoryEvent,
  MemoryEventTypeValue,
} from '../components/builtin/memory/memory.types.js';

// ============ Framework Events ============
// Events that are part of the framework itself, not tied to a specific component

import type { BaseEvent } from './base-event.types.js';

/**
 * Framework event types (not tied to specific components)
 */
export const FrameworkEventType = {
  // External Events
  EXTERNAL_INJECT: 'EXTERNAL_INJECT',
  EXTERNAL_TIMER: 'EXTERNAL_TIMER',
  ENVIRONMENT_CHANGE: 'ENVIRONMENT_CHANGE',

  // Lifecycle Events
  EXECUTION_RETRY: 'EXECUTION_RETRY',
  EXECUTION_RESUME: 'EXECUTION_RESUME',
  EXECUTION_PAUSE: 'EXECUTION_PAUSE',

  // Component Events (hot-plug)
  COMPONENT_ENABLE: 'COMPONENT_ENABLE',
  COMPONENT_DISABLE: 'COMPONENT_DISABLE',
  COMPONENT_DATA_UPDATE: 'COMPONENT_DATA_UPDATE',
} as const;

export type FrameworkEventTypeValue =
  (typeof FrameworkEventType)[keyof typeof FrameworkEventType];

// External Events
export interface ExternalInjectEvent extends BaseEvent<
  typeof FrameworkEventType.EXTERNAL_INJECT
> {
  source: string;
  content: unknown;
}

export interface ExternalTimerEvent extends BaseEvent<
  typeof FrameworkEventType.EXTERNAL_TIMER
> {
  timerId: string;
  payload?: unknown;
}

export interface EnvironmentChangeEvent extends BaseEvent<
  typeof FrameworkEventType.ENVIRONMENT_CHANGE
> {
  changeType: string;
  oldValue?: unknown;
  newValue?: unknown;
}

// Lifecycle Events
export interface ExecutionRetryEvent extends BaseEvent<
  typeof FrameworkEventType.EXECUTION_RETRY
> {
  retryTarget: string;
  attemptNumber: number;
  previousError?: string;
}

export interface ExecutionResumeEvent extends BaseEvent<
  typeof FrameworkEventType.EXECUTION_RESUME
> {
  resumeFromStateId?: string;
}

export interface ExecutionPauseEvent extends BaseEvent<
  typeof FrameworkEventType.EXECUTION_PAUSE
> {
  reason?: string;
}

// Component Events
export interface ComponentEnableEvent extends BaseEvent<
  typeof FrameworkEventType.COMPONENT_ENABLE
> {
  componentKey: string;
  config?: Record<string, unknown>;
}

export interface ComponentDisableEvent extends BaseEvent<
  typeof FrameworkEventType.COMPONENT_DISABLE
> {
  componentKey: string;
  preserveData?: boolean;
}

export interface ComponentDataUpdateEvent extends BaseEvent<
  typeof FrameworkEventType.COMPONENT_DATA_UPDATE
> {
  componentKey: string;
  key: string;
  value: unknown;
}

/** Union of framework events */
export type FrameworkEvent =
  | ExternalInjectEvent
  | ExternalTimerEvent
  | EnvironmentChangeEvent
  | ExecutionRetryEvent
  | ExecutionResumeEvent
  | ExecutionPauseEvent
  | ComponentEnableEvent
  | ComponentDisableEvent
  | ComponentDataUpdateEvent;

// ============ Unified Event Type (for backward compatibility) ============

/**
 * Unified EventType object that combines all component event types
 * This maintains backward compatibility with code using EventType.XXX
 *
 * NOTE: We define values here instead of re-exporting from component files
 * to avoid circular dependencies. Components import BaseEvent from this file,
 * so we can't import values from them.
 */
export const EventType = {
  // Error events
  TOOL_ERROR: 'TOOL_ERROR',
  SUBAGENT_ERROR: 'SUBAGENT_ERROR',
  SKILL_ERROR: 'SKILL_ERROR',
  SYSTEM_ERROR: 'SYSTEM_ERROR',

  // Task lifecycle events
  TASK_COMPLETED: 'TASK_COMPLETED',
  TASK_ABANDONED: 'TASK_ABANDONED',
  TASK_TERMINATED: 'TASK_TERMINATED',

  // Working history events
  USER_MESSAGE: 'USER_MESSAGE',
  PARENT_AGENT_MESSAGE: 'PARENT_AGENT_MESSAGE',
  LLM_TEXT_RESPONSE: 'LLM_TEXT_RESPONSE',
  LLM_TOOL_CALL: 'LLM_TOOL_CALL',
  LLM_SKILL_CALL: 'LLM_SKILL_CALL',
  LLM_SUBAGENT_SPAWN: 'LLM_SUBAGENT_SPAWN',
  LLM_SUBAGENT_MESSAGE: 'LLM_SUBAGENT_MESSAGE',
  LLM_CLARIFICATION: 'LLM_CLARIFICATION',
  TOOL_RESULT: 'TOOL_RESULT',
  SKILL_RESULT: 'SKILL_RESULT',
  SUBAGENT_RESULT: 'SUBAGENT_RESULT',

  // Todo events
  TODO_SET: 'TODO_SET',
  TODO_COMPLETED: 'TODO_COMPLETED',
  TODO_EXPANDED: 'TODO_EXPANDED',
  TODO_UPDATED: 'TODO_UPDATED',
  TODO_DELETED: 'TODO_DELETED',

  // Memory events
  MEMORY_MARK_CRITICAL: 'MEMORY_MARK_CRITICAL',
  MEMORY_FORGET: 'MEMORY_FORGET',
  MEMORY_COMPACT_MANUAL: 'MEMORY_COMPACT_MANUAL',
  MEMORY_COMPACT_AUTO: 'MEMORY_COMPACT_AUTO',

  // Framework events
  ...FrameworkEventType,
} as const;

export type EventTypeValue = (typeof EventType)[keyof typeof EventType];
