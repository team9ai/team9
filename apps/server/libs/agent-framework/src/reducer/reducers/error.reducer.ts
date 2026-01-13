import { MemoryState } from '../../types/state.types.js';
import {
  ChunkType,
  ChunkRetentionStrategy,
  ChunkContentType,
  MemoryChunk,
} from '../../types/chunk.types.js';
import {
  BaseEvent,
  EventType,
  ToolErrorEvent,
  SubAgentErrorEvent,
  SkillErrorEvent,
  SystemErrorEvent,
} from '../../types/event.types.js';
import { EventReducer, ReducerResult } from '../reducer.types.js';
import { createChunk, deriveChunk } from '../../factories/chunk.factory.js';
import {
  createAddOperation,
  createUpdateOperation,
} from '../../factories/operation.factory.js';

/**
 * Find the current WORKING_HISTORY container chunk in state
 */
function findWorkingHistoryChunk(state: MemoryState): MemoryChunk | undefined {
  for (const chunkId of state.chunkIds) {
    const chunk = state.chunks.get(chunkId);
    if (chunk?.type === ChunkType.WORKING_HISTORY) {
      return chunk;
    }
  }
  return undefined;
}

/**
 * Create a conversation chunk and add it to working history
 */
function createConversationResult(
  state: MemoryState,
  chunkType: ChunkType,
  content: Record<string, unknown>,
  eventMeta: { eventType: string; timestamp: number },
): ReducerResult {
  // Create the conversation chunk
  const conversationChunk = createChunk({
    type: chunkType,
    content: {
      type: ChunkContentType.TEXT,
      ...content,
    },
    custom: eventMeta,
  });

  const existingHistory = findWorkingHistoryChunk(state);

  if (existingHistory) {
    // Update existing WORKING_HISTORY to add the new child ID
    const updatedHistory = deriveChunk(existingHistory, {
      parentIds: [existingHistory.id],
    });

    // Create updated history with new childIds
    const historyWithNewChild: MemoryChunk = {
      ...updatedHistory,
      childIds: [...(existingHistory.childIds || []), conversationChunk.id],
    };

    return {
      operations: [
        createAddOperation(conversationChunk.id),
        createUpdateOperation(existingHistory.id, historyWithNewChild.id),
      ],
      chunks: [conversationChunk, historyWithNewChild],
    };
  } else {
    // Create new WORKING_HISTORY container with this chunk as first child
    const historyChunk = createChunk({
      type: ChunkType.WORKING_HISTORY,
      content: {
        type: ChunkContentType.TEXT,
        text: '',
      },
    });

    // Add childIds to the history chunk
    const historyWithChild: MemoryChunk = {
      ...historyChunk,
      childIds: [conversationChunk.id],
    };

    return {
      operations: [
        createAddOperation(conversationChunk.id),
        createAddOperation(historyWithChild.id),
      ],
      chunks: [conversationChunk, historyWithChild],
    };
  }
}

/**
 * Reducer for TOOL_ERROR events
 */
export class ToolErrorReducer implements EventReducer<ToolErrorEvent> {
  readonly eventTypes = [EventType.TOOL_ERROR];

  canHandle(event: BaseEvent): event is ToolErrorEvent {
    return event.type === EventType.TOOL_ERROR;
  }

  reduce(state: MemoryState, event: ToolErrorEvent): ReducerResult {
    return createConversationResult(
      state,
      ChunkType.ACTION_RESPONSE,
      {
        source: 'tool_error',
        toolName: event.toolName,
        callId: event.callId,
        error: event.error,
        errorDetails: event.errorDetails,
        status: 'error',
      },
      {
        eventType: event.type,
        timestamp: event.timestamp,
      },
    );
  }
}

/**
 * Reducer for SUBAGENT_ERROR events
 * Creates a child entry in WORKING_HISTORY for subagent errors
 */
export class SubAgentErrorReducer implements EventReducer<SubAgentErrorEvent> {
  readonly eventTypes = [EventType.SUBAGENT_ERROR];

  canHandle(event: BaseEvent): event is SubAgentErrorEvent {
    return event.type === EventType.SUBAGENT_ERROR;
  }

  reduce(state: MemoryState, event: SubAgentErrorEvent): ReducerResult {
    return createConversationResult(
      state,
      ChunkType.SUBAGENT_RESULT,
      {
        text: `Subagent error: ${event.error}`,
        action: 'subagent_error',
        subAgentId: event.subAgentId,
        error: event.error,
        errorDetails: event.errorDetails,
        success: false,
      },
      {
        eventType: event.type,
        timestamp: event.timestamp,
      },
    );
  }
}

/**
 * Reducer for SKILL_ERROR events
 */
export class SkillErrorReducer implements EventReducer<SkillErrorEvent> {
  readonly eventTypes = [EventType.SKILL_ERROR];

  canHandle(event: BaseEvent): event is SkillErrorEvent {
    return event.type === EventType.SKILL_ERROR;
  }

  reduce(state: MemoryState, event: SkillErrorEvent): ReducerResult {
    return createConversationResult(
      state,
      ChunkType.ACTION_RESPONSE,
      {
        source: 'skill_error',
        skillName: event.skillName,
        callId: event.callId,
        error: event.error,
        errorDetails: event.errorDetails,
        status: 'error',
      },
      {
        eventType: event.type,
        timestamp: event.timestamp,
      },
    );
  }
}

/**
 * Reducer for SYSTEM_ERROR events
 */
export class SystemErrorReducer implements EventReducer<SystemErrorEvent> {
  readonly eventTypes = [EventType.SYSTEM_ERROR];

  canHandle(event: BaseEvent): event is SystemErrorEvent {
    return event.type === EventType.SYSTEM_ERROR;
  }

  reduce(_state: MemoryState, event: SystemErrorEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.SYSTEM,
      content: {
        type: ChunkContentType.TEXT,
        errorType: 'system_error',
        code: event.code,
        error: event.error,
        errorDetails: event.errorDetails,
      },
      retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      custom: {
        eventType: event.type,
        timestamp: event.timestamp,
      },
    });

    const addOperation = createAddOperation(chunk.id);

    return {
      operations: [addOperation],
      chunks: [chunk],
    };
  }
}
