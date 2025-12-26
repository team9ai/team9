import { MemoryState } from '../../types/state.types';
import {
  ChunkType,
  ChunkRetentionStrategy,
  ChunkContentType,
} from '../../types/chunk.types';
import {
  AgentEvent,
  EventType,
  UserMessageEvent,
  ParentAgentMessageEvent,
} from '../../types/event.types';
import { EventReducer, ReducerResult } from '../reducer.types';
import { createChunk } from '../../factories/chunk.factory';
import { createAddOperation } from '../../factories/operation.factory';

/**
 * Reducer for USER_MESSAGE events
 */
export class UserMessageReducer implements EventReducer<UserMessageEvent> {
  readonly eventTypes = [EventType.USER_MESSAGE];

  canHandle(event: AgentEvent): event is UserMessageEvent {
    return event.type === EventType.USER_MESSAGE;
  }

  reduce(_state: MemoryState, event: UserMessageEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.AGENT,
      content: {
        type: ChunkContentType.TEXT,
        role: 'user',
        text: event.content,
        attachments: event.attachments,
      },
      retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
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

/**
 * Reducer for PARENT_AGENT_MESSAGE events
 */
export class ParentAgentMessageReducer implements EventReducer<ParentAgentMessageEvent> {
  readonly eventTypes = [EventType.PARENT_AGENT_MESSAGE];

  canHandle(event: AgentEvent): event is ParentAgentMessageEvent {
    return event.type === EventType.PARENT_AGENT_MESSAGE;
  }

  reduce(_state: MemoryState, event: ParentAgentMessageEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.DELEGATION,
      content: {
        type: ChunkContentType.TEXT,
        role: 'parent',
        parentAgentId: event.parentAgentId,
        text: event.content,
        taskContext: event.taskContext,
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
