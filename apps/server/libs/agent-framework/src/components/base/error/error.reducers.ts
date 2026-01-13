/**
 * Error Component Reducers
 * Reducer functions for error events
 */

import type { MemoryState } from '../../../types/state.types.js';
import type {
  BaseEvent,
  ToolErrorEvent,
  SkillErrorEvent,
  SubAgentErrorEvent,
  SystemErrorEvent,
} from '../../../types/event.types.js';
import { ChunkType } from '../../../types/chunk.types.js';
import type { ReducerResult } from '../../../reducer/reducer.types.js';
import type { ComponentContext } from '../../component.interface.js';
import { createConversationResult } from '../working-history/working-history.operations.js';
import { createSystemErrorResult } from './error.operations.js';
import type { ErrorEntry } from './error.types.js';

/**
 * Track error in component data
 */
function trackError(context: ComponentContext, error: ErrorEntry): void {
  const errors = context.getData<ErrorEntry[]>('errors') ?? [];
  errors.push(error);
  context.setData('errors', errors);

  // Track error counts
  const counts = context.getData<Record<string, number>>('errorCounts') ?? {};
  counts[error.type] = (counts[error.type] ?? 0) + 1;
  context.setData('errorCounts', counts);
}

/**
 * Reduce TOOL_ERROR event
 */
export function reduceToolError(
  componentKey: string,
  state: MemoryState,
  event: BaseEvent,
  context: ComponentContext,
): ReducerResult {
  const errorEvent = event as ToolErrorEvent;

  // Track error in component data
  trackError(context, {
    id: errorEvent.callId,
    type: 'tool',
    severity: 'error',
    message: errorEvent.error,
    details: errorEvent.errorDetails,
    timestamp: errorEvent.timestamp,
  });

  return createConversationResult({
    componentKey,
    state,
    chunkType: ChunkType.ACTION_RESPONSE,
    content: {
      source: 'tool_error',
      toolName: errorEvent.toolName,
      callId: errorEvent.callId,
      error: errorEvent.error,
      errorDetails: errorEvent.errorDetails,
      status: 'error',
    },
    eventMeta: {
      eventType: errorEvent.type,
      timestamp: errorEvent.timestamp,
    },
  });
}

/**
 * Reduce SKILL_ERROR event
 */
export function reduceSkillError(
  componentKey: string,
  state: MemoryState,
  event: BaseEvent,
  context: ComponentContext,
): ReducerResult {
  const errorEvent = event as SkillErrorEvent;

  // Track error in component data
  trackError(context, {
    id: errorEvent.callId,
    type: 'skill',
    severity: 'error',
    message: errorEvent.error,
    details: errorEvent.errorDetails,
    timestamp: errorEvent.timestamp,
  });

  return createConversationResult({
    componentKey,
    state,
    chunkType: ChunkType.ACTION_RESPONSE,
    content: {
      source: 'skill_error',
      skillName: errorEvent.skillName,
      callId: errorEvent.callId,
      error: errorEvent.error,
      errorDetails: errorEvent.errorDetails,
      status: 'error',
    },
    eventMeta: {
      eventType: errorEvent.type,
      timestamp: errorEvent.timestamp,
    },
  });
}

/**
 * Reduce SUBAGENT_ERROR event
 */
export function reduceSubAgentError(
  componentKey: string,
  state: MemoryState,
  event: BaseEvent,
  context: ComponentContext,
): ReducerResult {
  const errorEvent = event as SubAgentErrorEvent;

  // Track error in component data
  trackError(context, {
    id: errorEvent.subAgentId,
    type: 'subagent',
    severity: 'error',
    message: errorEvent.error,
    details: errorEvent.errorDetails,
    timestamp: errorEvent.timestamp,
  });

  return createConversationResult({
    componentKey,
    state,
    chunkType: ChunkType.SUBAGENT_RESULT,
    content: {
      text: `Subagent error: ${errorEvent.error}`,
      action: 'subagent_error',
      subAgentId: errorEvent.subAgentId,
      error: errorEvent.error,
      errorDetails: errorEvent.errorDetails,
      success: false,
    },
    eventMeta: {
      eventType: errorEvent.type,
      timestamp: errorEvent.timestamp,
    },
  });
}

/**
 * Reduce SYSTEM_ERROR event
 */
export function reduceSystemError(
  componentKey: string,
  _state: MemoryState,
  event: BaseEvent,
  context: ComponentContext,
): ReducerResult {
  const errorEvent = event as SystemErrorEvent;

  // Track error in component data
  trackError(context, {
    id: `system_${errorEvent.timestamp}`,
    type: 'system',
    severity: 'critical',
    message: errorEvent.error,
    details: errorEvent.errorDetails,
    timestamp: errorEvent.timestamp,
  });

  // System errors create standalone SYSTEM chunks
  return createSystemErrorResult({
    componentKey,
    code: errorEvent.code,
    error: errorEvent.error,
    errorDetails: errorEvent.errorDetails,
    eventType: errorEvent.type,
    timestamp: errorEvent.timestamp,
  });
}
