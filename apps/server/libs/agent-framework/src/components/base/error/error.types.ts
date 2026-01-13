/**
 * Error Component Types
 * Type definitions for error handling
 */

import type { BaseEvent } from '../../../types/base-event.types.js';

// ============ Event Types ============

/**
 * Error event type enum values for this component
 */
export const ErrorEventType = {
  TOOL_ERROR: 'TOOL_ERROR',
  SUBAGENT_ERROR: 'SUBAGENT_ERROR',
  SKILL_ERROR: 'SKILL_ERROR',
  SYSTEM_ERROR: 'SYSTEM_ERROR',
} as const;

export type ErrorEventTypeValue =
  (typeof ErrorEventType)[keyof typeof ErrorEventType];

// ============ Event Interfaces ============

export interface ToolErrorEvent extends BaseEvent<
  typeof ErrorEventType.TOOL_ERROR
> {
  /** Tool that failed */
  toolName: string;
  /** Tool call ID */
  callId: string;
  /** Error message */
  error: string;
  /** Error details */
  errorDetails?: unknown;
}

export interface SubAgentErrorEvent extends BaseEvent<
  typeof ErrorEventType.SUBAGENT_ERROR
> {
  /** SubAgent ID */
  subAgentId: string;
  /** Error message */
  error: string;
  /** Error details */
  errorDetails?: unknown;
}

export interface SkillErrorEvent extends BaseEvent<
  typeof ErrorEventType.SKILL_ERROR
> {
  /** Skill name */
  skillName: string;
  /** Skill call ID */
  callId: string;
  /** Error message */
  error: string;
  /** Error details */
  errorDetails?: unknown;
}

export interface SystemErrorEvent extends BaseEvent<
  typeof ErrorEventType.SYSTEM_ERROR
> {
  /** Error code */
  code: string;
  /** Error message */
  error: string;
  /** Error details */
  errorDetails?: unknown;
}

/** Union of all error events */
export type ErrorEvent =
  | ToolErrorEvent
  | SubAgentErrorEvent
  | SkillErrorEvent
  | SystemErrorEvent;

// ============ Component Types ============

/**
 * Error severity levels
 */
export type ErrorSeverity = 'warning' | 'error' | 'critical';

/**
 * Error entry stored in component data
 */
export interface ErrorEntry {
  id: string;
  type: 'tool' | 'skill' | 'subagent' | 'system';
  severity: ErrorSeverity;
  message: string;
  details?: unknown;
  timestamp: number;
}
