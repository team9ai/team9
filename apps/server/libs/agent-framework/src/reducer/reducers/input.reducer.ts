import { MemoryState } from '../../types/state.types.js';
import {
  ChunkType,
  ChunkRetentionStrategy,
  ChunkContentType,
  WorkingFlowSubType,
  MemoryChunk,
} from '../../types/chunk.types.js';
import {
  AgentEvent,
  EventType,
  UserMessageEvent,
  ParentAgentMessageEvent,
} from '../../types/event.types.js';
import { EventReducer, ReducerResult } from '../reducer.types.js';
import { createChunk } from '../../factories/chunk.factory.js';
import {
  createAddOperation,
  createAddChildOperation,
} from '../../factories/operation.factory.js';
import { generateChildId } from '../../utils/id.utils.js';

/**
 * Find the current WORKING_FLOW container chunk in state
 */
function findWorkingFlowChunk(state: MemoryState): MemoryChunk | undefined {
  for (const chunkId of state.chunkIds) {
    const chunk = state.chunks.get(chunkId);
    if (
      chunk?.type === ChunkType.WORKING_FLOW &&
      chunk.children !== undefined
    ) {
      return chunk;
    }
  }
  return undefined;
}

/**
 * Reducer for USER_MESSAGE events
 */
export class UserMessageReducer implements EventReducer<UserMessageEvent> {
  readonly eventTypes = [EventType.USER_MESSAGE];

  canHandle(event: AgentEvent): event is UserMessageEvent {
    return event.type === EventType.USER_MESSAGE;
  }

  reduce(state: MemoryState, event: UserMessageEvent): ReducerResult {
    const childContent = {
      type: ChunkContentType.TEXT,
      text: event.content,
      attachments: event.attachments,
    };

    const existingWorkingFlow = findWorkingFlowChunk(state);

    if (existingWorkingFlow) {
      // Add as a child to existing WORKING_FLOW chunk
      const addChildOp = createAddChildOperation(existingWorkingFlow.id, {
        id: generateChildId(),
        subType: WorkingFlowSubType.USER,
        content: childContent,
        createdAt: Date.now(),
        custom: {
          eventType: event.type,
          timestamp: event.timestamp,
        },
      });

      return {
        operations: [addChildOp],
        chunks: [],
      };
    } else {
      // Create a new WORKING_FLOW container chunk with this message as first child
      const chunk = createChunk({
        type: ChunkType.WORKING_FLOW,
        content: {
          type: ChunkContentType.TEXT,
          text: '', // Container has empty content, children hold actual content
        },
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
        custom: {},
      });

      // Add the chunk with the first child already included
      const chunkWithChild: MemoryChunk = {
        ...chunk,
        children: [
          {
            id: generateChildId(),
            subType: WorkingFlowSubType.USER,
            content: childContent,
            createdAt: Date.now(),
            custom: {
              eventType: event.type,
              timestamp: event.timestamp,
            },
          },
        ],
      };

      const addOperation = createAddOperation(chunkWithChild.id);

      return {
        operations: [addOperation],
        chunks: [chunkWithChild],
      };
    }
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
