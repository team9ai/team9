import { MemoryState } from '../../types/state.types.js';
import {
  ChunkType,
  ChunkContentType,
  MemoryChunk,
} from '../../types/chunk.types.js';
import {
  AgentEvent,
  EventType,
  ToolResultEvent,
  SkillResultEvent,
  SubAgentResultEvent,
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
 * Reducer for TOOL_RESULT events
 */
export class ToolResultReducer implements EventReducer<ToolResultEvent> {
  readonly eventTypes = [EventType.TOOL_RESULT];

  canHandle(event: AgentEvent): event is ToolResultEvent {
    return event.type === EventType.TOOL_RESULT;
  }

  reduce(state: MemoryState, event: ToolResultEvent): ReducerResult {
    return createConversationResult(
      state,
      ChunkType.ACTION_RESPONSE,
      {
        source: 'tool',
        toolName: event.toolName,
        callId: event.callId,
        result: event.result,
        success: event.success,
        status: event.success ? 'success' : 'error',
      },
      {
        eventType: event.type,
        timestamp: event.timestamp,
      },
    );
  }
}

/**
 * Reducer for SKILL_RESULT events
 */
export class SkillResultReducer implements EventReducer<SkillResultEvent> {
  readonly eventTypes = [EventType.SKILL_RESULT];

  canHandle(event: AgentEvent): event is SkillResultEvent {
    return event.type === EventType.SKILL_RESULT;
  }

  reduce(state: MemoryState, event: SkillResultEvent): ReducerResult {
    return createConversationResult(
      state,
      ChunkType.ACTION_RESPONSE,
      {
        source: 'skill',
        skillName: event.skillName,
        callId: event.callId,
        result: event.result,
        success: event.success,
        status: event.success ? 'success' : 'error',
      },
      {
        eventType: event.type,
        timestamp: event.timestamp,
      },
    );
  }
}

/**
 * Reducer for SUBAGENT_RESULT events
 */
export class SubAgentResultReducer implements EventReducer<SubAgentResultEvent> {
  readonly eventTypes = [EventType.SUBAGENT_RESULT];

  canHandle(event: AgentEvent): event is SubAgentResultEvent {
    return event.type === EventType.SUBAGENT_RESULT;
  }

  reduce(state: MemoryState, event: SubAgentResultEvent): ReducerResult {
    return createConversationResult(
      state,
      ChunkType.SUBAGENT_RESULT,
      {
        text: `Subagent result (${event.success ? 'success' : 'failed'}): ${JSON.stringify(event.result)}`,
        subAgentId: event.subAgentId,
        result: event.result,
        success: event.success,
      },
      {
        eventType: event.type,
        timestamp: event.timestamp,
      },
    );
  }
}
