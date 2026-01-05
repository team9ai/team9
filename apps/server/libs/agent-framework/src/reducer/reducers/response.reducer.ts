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
  ToolResultEvent,
  SkillResultEvent,
  SubAgentResultEvent,
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
 * Reducer for TOOL_RESULT events
 */
export class ToolResultReducer implements EventReducer<ToolResultEvent> {
  readonly eventTypes = [EventType.TOOL_RESULT];

  canHandle(event: AgentEvent): event is ToolResultEvent {
    return event.type === EventType.TOOL_RESULT;
  }

  reduce(state: MemoryState, event: ToolResultEvent): ReducerResult {
    const childContent = {
      type: ChunkContentType.TEXT,
      source: 'tool',
      toolName: event.toolName,
      callId: event.callId,
      result: event.result,
      success: event.success,
      status: event.success ? 'success' : 'error',
    };

    const existingWorkingFlow = findWorkingFlowChunk(state);

    if (existingWorkingFlow) {
      // Add as a child to existing WORKING_FLOW chunk
      const addChildOp = createAddChildOperation(existingWorkingFlow.id, {
        id: generateChildId(),
        subType: WorkingFlowSubType.ACTION_RESPONSE,
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
      // Create a new WORKING_FLOW container chunk with this result as first child
      const chunk = createChunk({
        type: ChunkType.WORKING_FLOW,
        content: {
          type: ChunkContentType.TEXT,
          text: '', // Container has empty content, children hold actual content
        },
        retentionStrategy: ChunkRetentionStrategy.BATCH_COMPRESSIBLE,
        custom: {},
      });

      // Add the chunk with the first child already included
      const chunkWithChild: MemoryChunk = {
        ...chunk,
        children: [
          {
            id: generateChildId(),
            subType: WorkingFlowSubType.ACTION_RESPONSE,
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
 * Reducer for SKILL_RESULT events
 */
export class SkillResultReducer implements EventReducer<SkillResultEvent> {
  readonly eventTypes = [EventType.SKILL_RESULT];

  canHandle(event: AgentEvent): event is SkillResultEvent {
    return event.type === EventType.SKILL_RESULT;
  }

  reduce(state: MemoryState, event: SkillResultEvent): ReducerResult {
    const childContent = {
      type: ChunkContentType.TEXT,
      source: 'skill',
      skillName: event.skillName,
      callId: event.callId,
      result: event.result,
      success: event.success,
      status: event.success ? 'success' : 'error',
    };

    const existingWorkingFlow = findWorkingFlowChunk(state);

    if (existingWorkingFlow) {
      // Add as a child to existing WORKING_FLOW chunk
      const addChildOp = createAddChildOperation(existingWorkingFlow.id, {
        id: generateChildId(),
        subType: WorkingFlowSubType.ACTION_RESPONSE,
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
      // Create a new WORKING_FLOW container chunk with this result as first child
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
            subType: WorkingFlowSubType.ACTION_RESPONSE,
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
 * Reducer for SUBAGENT_RESULT events
 */
export class SubAgentResultReducer implements EventReducer<SubAgentResultEvent> {
  readonly eventTypes = [EventType.SUBAGENT_RESULT];

  canHandle(event: AgentEvent): event is SubAgentResultEvent {
    return event.type === EventType.SUBAGENT_RESULT;
  }

  reduce(_state: MemoryState, event: SubAgentResultEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.DELEGATION,
      content: {
        type: ChunkContentType.TEXT,
        action: 'subagent_result',
        subAgentId: event.subAgentId,
        result: event.result,
        success: event.success,
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
