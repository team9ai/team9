import { MemoryState } from '../../types/state.types';
import {
  ChunkType,
  ChunkRetentionStrategy,
  ChunkContentType,
} from '../../types/chunk.types';
import {
  AgentEvent,
  EventType,
  ToolErrorEvent,
  SubAgentErrorEvent,
  SkillErrorEvent,
  SystemErrorEvent,
} from '../../types/event.types';
import { EventReducer, ReducerResult } from '../reducer.types';
import { createChunk } from '../../factories/chunk.factory';
import { createAddOperation } from '../../factories/operation.factory';

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
 */
export class SubAgentErrorReducer implements EventReducer<SubAgentErrorEvent> {
  readonly eventTypes = [EventType.SUBAGENT_ERROR];

  canHandle(event: AgentEvent): event is SubAgentErrorEvent {
    return event.type === EventType.SUBAGENT_ERROR;
  }

  reduce(_state: MemoryState, event: SubAgentErrorEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.DELEGATION,
      content: {
        type: ChunkContentType.TEXT,
        action: 'subagent_error',
        subAgentId: event.subAgentId,
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
