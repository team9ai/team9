import { MemoryState } from '../../types/state.types.js';
import {
  ChunkType,
  ChunkContentType,
  MemoryChunk,
} from '../../types/chunk.types.js';
import {
  BaseEvent,
  EventType,
  UserMessageEvent,
  ParentAgentMessageEvent,
} from '../../types/event.types.js';
import { EventReducer, ReducerResult } from '../reducer.types.js';
import { createChunk, deriveChunk } from '../../factories/chunk.factory.js';
import {
  createAddOperation,
  createUpdateOperation,
} from '../../factories/operation.factory.js';

/**
 * Find the WORKING_HISTORY container chunk in state
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
    custom: {
      eventType: eventMeta.eventType,
      timestamp: eventMeta.timestamp,
    },
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
 * Reducer for USER_MESSAGE events
 */
export class UserMessageReducer implements EventReducer<UserMessageEvent> {
  readonly eventTypes = [EventType.USER_MESSAGE];

  canHandle(event: BaseEvent): event is UserMessageEvent {
    return event.type === EventType.USER_MESSAGE;
  }

  reduce(state: MemoryState, event: UserMessageEvent): ReducerResult {
    return createConversationResult(
      state,
      ChunkType.USER_MESSAGE,
      {
        text: event.content,
        attachments: event.attachments,
      },
      { eventType: event.type, timestamp: event.timestamp },
    );
  }
}

/**
 * Reducer for PARENT_AGENT_MESSAGE events
 * Creates a chunk for messages from parent agent
 */
export class ParentAgentMessageReducer implements EventReducer<ParentAgentMessageEvent> {
  readonly eventTypes = [EventType.PARENT_AGENT_MESSAGE];

  canHandle(event: BaseEvent): event is ParentAgentMessageEvent {
    return event.type === EventType.PARENT_AGENT_MESSAGE;
  }

  reduce(state: MemoryState, event: ParentAgentMessageEvent): ReducerResult {
    return createConversationResult(
      state,
      ChunkType.PARENT_MESSAGE,
      {
        text: event.content,
        parentAgentId: event.parentAgentId,
        taskContext: event.taskContext,
      },
      { eventType: event.type, timestamp: event.timestamp },
    );
  }
}
