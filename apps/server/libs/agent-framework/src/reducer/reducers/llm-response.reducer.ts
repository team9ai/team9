import { MemoryState } from '../../types/state.types.js';
import {
  ChunkType,
  ChunkContentType,
  MemoryChunk,
} from '../../types/chunk.types.js';
import {
  AgentEvent,
  EventType,
  LLMTextResponseEvent,
  LLMToolCallEvent,
  LLMSkillCallEvent,
  LLMSubAgentSpawnEvent,
  LLMSubAgentMessageEvent,
  LLMClarificationEvent,
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
  eventMeta: { eventType: string; timestamp: number; [key: string]: unknown },
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
 * Reducer for LLM_TEXT_RESPONSE events
 */
export class LLMTextResponseReducer implements EventReducer<LLMTextResponseEvent> {
  readonly eventTypes = [EventType.LLM_TEXT_RESPONSE];

  canHandle(event: AgentEvent): event is LLMTextResponseEvent {
    return event.type === EventType.LLM_TEXT_RESPONSE;
  }

  reduce(state: MemoryState, event: LLMTextResponseEvent): ReducerResult {
    return createConversationResult(
      state,
      ChunkType.AGENT_RESPONSE,
      {
        role: 'assistant',
        text: event.content,
      },
      {
        eventType: event.type,
        timestamp: event.timestamp,
        model: event.model,
        usage: event.usage,
      },
    );
  }
}

/**
 * Reducer for LLM_TOOL_CALL events
 * Adds tool call as a child of WORKING_HISTORY with AGENT_ACTION type
 */
export class LLMToolCallReducer implements EventReducer<LLMToolCallEvent> {
  readonly eventTypes = [EventType.LLM_TOOL_CALL];

  canHandle(event: AgentEvent): event is LLMToolCallEvent {
    return event.type === EventType.LLM_TOOL_CALL;
  }

  reduce(state: MemoryState, event: LLMToolCallEvent): ReducerResult {
    return createConversationResult(
      state,
      ChunkType.AGENT_ACTION,
      {
        action: 'tool_call',
        toolName: event.toolName,
        callId: event.callId,
        arguments: event.arguments,
        status: 'pending',
      },
      {
        eventType: event.type,
        timestamp: event.timestamp,
      },
    );
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

  reduce(state: MemoryState, event: LLMSkillCallEvent): ReducerResult {
    return createConversationResult(
      state,
      ChunkType.AGENT_ACTION,
      {
        action: 'skill_call',
        skillName: event.skillName,
        callId: event.callId,
        input: event.input,
        status: 'pending',
      },
      {
        eventType: event.type,
        timestamp: event.timestamp,
      },
    );
  }
}

/**
 * Reducer for LLM_SUBAGENT_SPAWN events
 * Creates a child entry in WORKING_HISTORY to indicate subagent has been spawned
 */
export class LLMSubAgentSpawnReducer implements EventReducer<LLMSubAgentSpawnEvent> {
  readonly eventTypes = [EventType.LLM_SUBAGENT_SPAWN];

  canHandle(event: AgentEvent): event is LLMSubAgentSpawnEvent {
    return event.type === EventType.LLM_SUBAGENT_SPAWN;
  }

  reduce(state: MemoryState, event: LLMSubAgentSpawnEvent): ReducerResult {
    return createConversationResult(
      state,
      ChunkType.SUBAGENT_SPAWN,
      {
        text: `Spawned subagent "${event.agentType}" with task: ${event.task}`,
        subAgentId: event.subAgentId,
        agentType: event.agentType,
        task: event.task,
        config: event.config,
        status: 'running',
      },
      {
        eventType: event.type,
        timestamp: event.timestamp,
      },
    );
  }
}

/**
 * Reducer for LLM_SUBAGENT_MESSAGE events
 * Creates a child entry in WORKING_HISTORY for messages to subagent
 */
export class LLMSubAgentMessageReducer implements EventReducer<LLMSubAgentMessageEvent> {
  readonly eventTypes = [EventType.LLM_SUBAGENT_MESSAGE];

  canHandle(event: AgentEvent): event is LLMSubAgentMessageEvent {
    return event.type === EventType.LLM_SUBAGENT_MESSAGE;
  }

  reduce(state: MemoryState, event: LLMSubAgentMessageEvent): ReducerResult {
    return createConversationResult(
      state,
      ChunkType.AGENT_ACTION,
      {
        text: `Message to subagent: ${event.content}`,
        action: 'message_subagent',
        subAgentId: event.subAgentId,
      },
      {
        eventType: event.type,
        timestamp: event.timestamp,
      },
    );
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

  reduce(state: MemoryState, event: LLMClarificationEvent): ReducerResult {
    return createConversationResult(
      state,
      ChunkType.AGENT_RESPONSE,
      {
        role: 'assistant',
        action: 'clarification',
        question: event.question,
        neededInfo: event.neededInfo,
      },
      {
        eventType: event.type,
        timestamp: event.timestamp,
      },
    );
  }
}
