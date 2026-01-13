/**
 * Working History Types
 * Type definitions for conversation history management
 */

import type { BaseEvent } from '../../../types/base-event.types.js';

// Re-export compaction types from shared types
export type {
  CompactionResult,
  CompactionConfig,
} from '../../../types/compaction.types.js';

// ============ Event Types ============

/**
 * Working history event type enum values for this component
 */
export const WorkingHistoryEventType = {
  // Input Events
  USER_MESSAGE: 'USER_MESSAGE',
  PARENT_AGENT_MESSAGE: 'PARENT_AGENT_MESSAGE',
  // LLM Response Events
  LLM_TEXT_RESPONSE: 'LLM_TEXT_RESPONSE',
  LLM_TOOL_CALL: 'LLM_TOOL_CALL',
  LLM_SKILL_CALL: 'LLM_SKILL_CALL',
  LLM_SUBAGENT_SPAWN: 'LLM_SUBAGENT_SPAWN',
  LLM_SUBAGENT_MESSAGE: 'LLM_SUBAGENT_MESSAGE',
  LLM_CLARIFICATION: 'LLM_CLARIFICATION',
  // Response Events
  TOOL_RESULT: 'TOOL_RESULT',
  SKILL_RESULT: 'SKILL_RESULT',
  SUBAGENT_RESULT: 'SUBAGENT_RESULT',
} as const;

export type WorkingHistoryEventTypeValue =
  (typeof WorkingHistoryEventType)[keyof typeof WorkingHistoryEventType];

// ============ Input Event Interfaces ============

export interface UserMessageEvent extends BaseEvent<
  typeof WorkingHistoryEventType.USER_MESSAGE
> {
  /** Message content */
  content: string;
  /** Optional attachments */
  attachments?: unknown[];
}

export interface ParentAgentMessageEvent extends BaseEvent<
  typeof WorkingHistoryEventType.PARENT_AGENT_MESSAGE
> {
  /** Parent agent ID */
  parentAgentId: string;
  /** Message content */
  content: string;
  /** Task context */
  taskContext?: Record<string, unknown>;
}

// ============ LLM Response Event Interfaces ============

export interface LLMTextResponseEvent extends BaseEvent<
  typeof WorkingHistoryEventType.LLM_TEXT_RESPONSE
> {
  /** Response content */
  content: string;
  /** Model used */
  model?: string;
  /** Token usage */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMToolCallEvent extends BaseEvent<
  typeof WorkingHistoryEventType.LLM_TOOL_CALL
> {
  /** Tool name */
  toolName: string;
  /** Tool call ID */
  callId: string;
  /** Tool arguments */
  arguments: Record<string, unknown>;
}

export interface LLMSkillCallEvent extends BaseEvent<
  typeof WorkingHistoryEventType.LLM_SKILL_CALL
> {
  /** Skill name */
  skillName: string;
  /** Skill call ID */
  callId: string;
  /** Skill input */
  input: unknown;
}

export interface LLMSubAgentSpawnEvent extends BaseEvent<
  typeof WorkingHistoryEventType.LLM_SUBAGENT_SPAWN
> {
  /** SubAgent ID */
  subAgentId: string;
  /** SubAgent type/role */
  agentType: string;
  /** Initial task/instruction */
  task: string;
  /** Configuration */
  config?: Record<string, unknown>;
}

export interface LLMSubAgentMessageEvent extends BaseEvent<
  typeof WorkingHistoryEventType.LLM_SUBAGENT_MESSAGE
> {
  /** Target SubAgent ID */
  subAgentId: string;
  /** Message content */
  content: string;
}

export interface LLMClarificationEvent extends BaseEvent<
  typeof WorkingHistoryEventType.LLM_CLARIFICATION
> {
  /** Clarification question */
  question: string;
  /** What information is needed */
  neededInfo?: string[];
}

// ============ Response Event Interfaces ============

export interface ToolResultEvent extends BaseEvent<
  typeof WorkingHistoryEventType.TOOL_RESULT
> {
  /** Tool name */
  toolName: string;
  /** Tool call ID */
  callId: string;
  /** Result content */
  result: unknown;
  /** Whether execution was successful */
  success: boolean;
}

export interface SkillResultEvent extends BaseEvent<
  typeof WorkingHistoryEventType.SKILL_RESULT
> {
  /** Skill name */
  skillName: string;
  /** Skill call ID */
  callId: string;
  /** Result content */
  result: unknown;
  /** Whether execution was successful */
  success: boolean;
}

export interface SubAgentResultEvent extends BaseEvent<
  typeof WorkingHistoryEventType.SUBAGENT_RESULT
> {
  /** SubAgent ID (the subagent key, not the thread ID) */
  subAgentId: string;
  /** Child thread ID (the actual thread ID of the subagent) */
  childThreadId?: string;
  /** Result content */
  result: unknown;
  /** Whether task was successful */
  success: boolean;
}

/** Union of all working history events */
export type WorkingHistoryEvent =
  // Input Events
  | UserMessageEvent
  | ParentAgentMessageEvent
  // LLM Response Events
  | LLMTextResponseEvent
  | LLMToolCallEvent
  | LLMSkillCallEvent
  | LLMSubAgentSpawnEvent
  | LLMSubAgentMessageEvent
  | LLMClarificationEvent
  // Response Events
  | ToolResultEvent
  | SkillResultEvent
  | SubAgentResultEvent;
