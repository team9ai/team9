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
  ToolErrorEvent,
  SubAgentErrorEvent,
  SkillErrorEvent,
  SystemErrorEvent,
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
 * Reducer for TOOL_ERROR events
 */
export class ToolErrorReducer implements EventReducer<ToolErrorEvent> {
  readonly eventTypes = [EventType.TOOL_ERROR];

  canHandle(event: AgentEvent): event is ToolErrorEvent {
    return event.type === EventType.TOOL_ERROR;
  }

  reduce(_state: MemoryState, event: ToolErrorEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.ENVIRONMENT,
      content: {
        type: ChunkContentType.TEXT,
        source: 'tool_error',
        toolName: event.toolName,
        callId: event.callId,
        error: event.error,
        errorDetails: event.errorDetails,
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
 * Reducer for SUBAGENT_ERROR events
 * Creates a child entry in WORKING_FLOW for subagent errors
 */
export class SubAgentErrorReducer implements EventReducer<SubAgentErrorEvent> {
  readonly eventTypes = [EventType.SUBAGENT_ERROR];

  canHandle(event: AgentEvent): event is SubAgentErrorEvent {
    return event.type === EventType.SUBAGENT_ERROR;
  }

  reduce(state: MemoryState, event: SubAgentErrorEvent): ReducerResult {
    const childContent = {
      type: ChunkContentType.TEXT,
      text: `Subagent error: ${event.error}`,
      action: 'subagent_error',
      subAgentId: event.subAgentId,
      error: event.error,
      errorDetails: event.errorDetails,
    };

    const existingWorkingFlow = findWorkingFlowChunk(state);

    if (existingWorkingFlow) {
      const addChildOp = createAddChildOperation(existingWorkingFlow.id, {
        id: generateChildId(),
        subType: WorkingFlowSubType.SUBAGENT_RESULT,
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
      const chunk = createChunk({
        type: ChunkType.WORKING_FLOW,
        content: {
          type: ChunkContentType.TEXT,
          text: '',
        },
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
        custom: {},
      });

      const chunkWithChild: MemoryChunk = {
        ...chunk,
        children: [
          {
            id: generateChildId(),
            subType: WorkingFlowSubType.SUBAGENT_RESULT,
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
 * Reducer for SKILL_ERROR events
 */
export class SkillErrorReducer implements EventReducer<SkillErrorEvent> {
  readonly eventTypes = [EventType.SKILL_ERROR];

  canHandle(event: AgentEvent): event is SkillErrorEvent {
    return event.type === EventType.SKILL_ERROR;
  }

  reduce(_state: MemoryState, event: SkillErrorEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.ENVIRONMENT,
      content: {
        type: ChunkContentType.TEXT,
        source: 'skill_error',
        skillName: event.skillName,
        callId: event.callId,
        error: event.error,
        errorDetails: event.errorDetails,
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
 * Reducer for SYSTEM_ERROR events
 */
export class SystemErrorReducer implements EventReducer<SystemErrorEvent> {
  readonly eventTypes = [EventType.SYSTEM_ERROR];

  canHandle(event: AgentEvent): event is SystemErrorEvent {
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
