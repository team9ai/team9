import { MemoryState } from '../../types/state.types';
import {
  ChunkType,
  ChunkRetentionStrategy,
  ChunkContentType,
} from '../../types/chunk.types';
import {
  AgentEvent,
  EventType,
  ToolResultEvent,
  SkillResultEvent,
  SubAgentResultEvent,
} from '../../types/event.types';
import { EventReducer, ReducerResult } from '../reducer.types';
import { createChunk } from '../../factories/chunk.factory';
import { createAddOperation } from '../../factories/operation.factory';

/**
 * Reducer for TOOL_RESULT events
 */
export class ToolResultReducer implements EventReducer<ToolResultEvent> {
  readonly eventTypes = [EventType.TOOL_RESULT];

  canHandle(event: AgentEvent): event is ToolResultEvent {
    return event.type === EventType.TOOL_RESULT;
  }

  reduce(_state: MemoryState, event: ToolResultEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.ENVIRONMENT,
      content: {
        type: ChunkContentType.TEXT,
        source: 'tool',
        toolName: event.toolName,
        callId: event.callId,
        result: event.result,
        success: event.success,
      },
      retentionStrategy: ChunkRetentionStrategy.BATCH_COMPRESSIBLE,
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
 * Reducer for SKILL_RESULT events
 */
export class SkillResultReducer implements EventReducer<SkillResultEvent> {
  readonly eventTypes = [EventType.SKILL_RESULT];

  canHandle(event: AgentEvent): event is SkillResultEvent {
    return event.type === EventType.SKILL_RESULT;
  }

  reduce(_state: MemoryState, event: SkillResultEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.ENVIRONMENT,
      content: {
        type: ChunkContentType.TEXT,
        source: 'skill',
        skillName: event.skillName,
        callId: event.callId,
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
