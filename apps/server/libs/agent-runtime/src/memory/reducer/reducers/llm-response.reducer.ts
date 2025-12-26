import { MemoryState } from '../../types/state.types';
import {
  ChunkType,
  ChunkRetentionStrategy,
  ChunkContentType,
} from '../../types/chunk.types';
import {
  AgentEvent,
  EventType,
  LLMTextResponseEvent,
  LLMToolCallEvent,
  LLMSkillCallEvent,
  LLMSubAgentSpawnEvent,
  LLMSubAgentMessageEvent,
  LLMClarificationEvent,
} from '../../types/event.types';
import { EventReducer, ReducerResult } from '../reducer.types';
import { createChunk } from '../../factories/chunk.factory';
import { createAddOperation } from '../../factories/operation.factory';

/**
 * Reducer for LLM_TEXT_RESPONSE events
 */
export class LLMTextResponseReducer implements EventReducer<LLMTextResponseEvent> {
  readonly eventTypes = [EventType.LLM_TEXT_RESPONSE];

  canHandle(event: AgentEvent): event is LLMTextResponseEvent {
    return event.type === EventType.LLM_TEXT_RESPONSE;
  }

  reduce(_state: MemoryState, event: LLMTextResponseEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.AGENT,
      content: {
        type: ChunkContentType.TEXT,
        role: 'assistant',
        text: event.content,
      },
      retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      custom: {
        eventType: event.type,
        timestamp: event.timestamp,
        model: event.model,
        usage: event.usage,
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
 * Reducer for LLM_TOOL_CALL events
 */
export class LLMToolCallReducer implements EventReducer<LLMToolCallEvent> {
  readonly eventTypes = [EventType.LLM_TOOL_CALL];

  canHandle(event: AgentEvent): event is LLMToolCallEvent {
    return event.type === EventType.LLM_TOOL_CALL;
  }

  reduce(_state: MemoryState, event: LLMToolCallEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.WORKFLOW,
      content: {
        type: ChunkContentType.TEXT,
        action: 'tool_call',
        toolName: event.toolName,
        callId: event.callId,
        arguments: event.arguments,
        status: 'pending',
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
 * Reducer for LLM_SKILL_CALL events
 */
export class LLMSkillCallReducer implements EventReducer<LLMSkillCallEvent> {
  readonly eventTypes = [EventType.LLM_SKILL_CALL];

  canHandle(event: AgentEvent): event is LLMSkillCallEvent {
    return event.type === EventType.LLM_SKILL_CALL;
  }

  reduce(_state: MemoryState, event: LLMSkillCallEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.WORKFLOW,
      content: {
        type: ChunkContentType.TEXT,
        action: 'skill_call',
        skillName: event.skillName,
        callId: event.callId,
        input: event.input,
        status: 'pending',
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
 * Reducer for LLM_SUBAGENT_SPAWN events
 */
export class LLMSubAgentSpawnReducer implements EventReducer<LLMSubAgentSpawnEvent> {
  readonly eventTypes = [EventType.LLM_SUBAGENT_SPAWN];

  canHandle(event: AgentEvent): event is LLMSubAgentSpawnEvent {
    return event.type === EventType.LLM_SUBAGENT_SPAWN;
  }

  reduce(_state: MemoryState, event: LLMSubAgentSpawnEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.DELEGATION,
      content: {
        type: ChunkContentType.TEXT,
        action: 'spawn_subagent',
        subAgentId: event.subAgentId,
        agentType: event.agentType,
        task: event.task,
        config: event.config,
        status: 'pending',
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

/**
 * Reducer for LLM_SUBAGENT_MESSAGE events
 */
export class LLMSubAgentMessageReducer implements EventReducer<LLMSubAgentMessageEvent> {
  readonly eventTypes = [EventType.LLM_SUBAGENT_MESSAGE];

  canHandle(event: AgentEvent): event is LLMSubAgentMessageEvent {
    return event.type === EventType.LLM_SUBAGENT_MESSAGE;
  }

  reduce(_state: MemoryState, event: LLMSubAgentMessageEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.DELEGATION,
      content: {
        type: ChunkContentType.TEXT,
        action: 'message_subagent',
        subAgentId: event.subAgentId,
        text: event.content,
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
 * Reducer for LLM_CLARIFICATION events
 */
export class LLMClarificationReducer implements EventReducer<LLMClarificationEvent> {
  readonly eventTypes = [EventType.LLM_CLARIFICATION];

  canHandle(event: AgentEvent): event is LLMClarificationEvent {
    return event.type === EventType.LLM_CLARIFICATION;
  }

  reduce(_state: MemoryState, event: LLMClarificationEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.AGENT,
      content: {
        type: ChunkContentType.TEXT,
        role: 'assistant',
        action: 'clarification',
        question: event.question,
        neededInfo: event.neededInfo,
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
