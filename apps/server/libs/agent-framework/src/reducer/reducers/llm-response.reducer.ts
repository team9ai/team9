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
  LLMTextResponseEvent,
  LLMToolCallEvent,
  LLMSkillCallEvent,
  LLMSubAgentSpawnEvent,
  LLMSubAgentMessageEvent,
  LLMClarificationEvent,
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
 * Reducer for LLM_TEXT_RESPONSE events
 */
export class LLMTextResponseReducer implements EventReducer<LLMTextResponseEvent> {
  readonly eventTypes = [EventType.LLM_TEXT_RESPONSE];

  canHandle(event: AgentEvent): event is LLMTextResponseEvent {
    return event.type === EventType.LLM_TEXT_RESPONSE;
  }

  reduce(state: MemoryState, event: LLMTextResponseEvent): ReducerResult {
    const childContent = {
      type: ChunkContentType.TEXT,
      role: 'assistant',
      text: event.content,
    };

    const existingWorkingFlow = findWorkingFlowChunk(state);

    if (existingWorkingFlow) {
      // Add as a child to existing WORKING_FLOW chunk
      const addChildOp = createAddChildOperation(existingWorkingFlow.id, {
        id: generateChildId(),
        subType: WorkingFlowSubType.RESPONSE,
        content: childContent,
        createdAt: Date.now(),
        custom: {
          eventType: event.type,
          timestamp: event.timestamp,
          model: event.model,
          usage: event.usage,
        },
      });

      return {
        operations: [addChildOp],
        chunks: [],
      };
    } else {
      // Create a new WORKING_FLOW container chunk with this response as first child
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
            subType: WorkingFlowSubType.RESPONSE,
            content: childContent,
            createdAt: Date.now(),
            custom: {
              eventType: event.type,
              timestamp: event.timestamp,
              model: event.model,
              usage: event.usage,
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
 * Reducer for LLM_TOOL_CALL events
 * Adds tool call as a child of WORKING_FLOW with AGENT_ACTION subType
 */
export class LLMToolCallReducer implements EventReducer<LLMToolCallEvent> {
  readonly eventTypes = [EventType.LLM_TOOL_CALL];

  canHandle(event: AgentEvent): event is LLMToolCallEvent {
    return event.type === EventType.LLM_TOOL_CALL;
  }

  reduce(state: MemoryState, event: LLMToolCallEvent): ReducerResult {
    const childContent = {
      type: ChunkContentType.TEXT,
      action: 'tool_call',
      toolName: event.toolName,
      callId: event.callId,
      arguments: event.arguments,
      status: 'pending',
    };

    const existingWorkingFlow = findWorkingFlowChunk(state);

    if (existingWorkingFlow) {
      // Add as a child to existing WORKING_FLOW chunk
      const addChildOp = createAddChildOperation(existingWorkingFlow.id, {
        id: generateChildId(),
        subType: WorkingFlowSubType.AGENT_ACTION,
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
      // Create a new WORKING_FLOW container chunk with this tool call as first child
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
            subType: WorkingFlowSubType.AGENT_ACTION,
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
 * Creates a child entry in WORKING_FLOW to indicate subagent has been spawned
 */
export class LLMSubAgentSpawnReducer implements EventReducer<LLMSubAgentSpawnEvent> {
  readonly eventTypes = [EventType.LLM_SUBAGENT_SPAWN];

  canHandle(event: AgentEvent): event is LLMSubAgentSpawnEvent {
    return event.type === EventType.LLM_SUBAGENT_SPAWN;
  }

  reduce(state: MemoryState, event: LLMSubAgentSpawnEvent): ReducerResult {
    const childContent = {
      type: ChunkContentType.TEXT,
      text: `Spawned subagent "${event.agentType}" with task: ${event.task}`,
      subAgentId: event.subAgentId,
      agentType: event.agentType,
      task: event.task,
      config: event.config,
      status: 'running',
    };

    const existingWorkingFlow = findWorkingFlowChunk(state);

    if (existingWorkingFlow) {
      // Add as a child to existing WORKING_FLOW chunk
      const addChildOp = createAddChildOperation(existingWorkingFlow.id, {
        id: generateChildId(),
        subType: WorkingFlowSubType.SUBAGENT_SPAWN,
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
      // Create a new WORKING_FLOW container chunk with this spawn as first child
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
            subType: WorkingFlowSubType.SUBAGENT_SPAWN,
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
 * Reducer for LLM_SUBAGENT_MESSAGE events
 * Creates a child entry in WORKING_FLOW for messages to subagent
 */
export class LLMSubAgentMessageReducer implements EventReducer<LLMSubAgentMessageEvent> {
  readonly eventTypes = [EventType.LLM_SUBAGENT_MESSAGE];

  canHandle(event: AgentEvent): event is LLMSubAgentMessageEvent {
    return event.type === EventType.LLM_SUBAGENT_MESSAGE;
  }

  reduce(state: MemoryState, event: LLMSubAgentMessageEvent): ReducerResult {
    const childContent = {
      type: ChunkContentType.TEXT,
      text: `Message to subagent: ${event.content}`,
      action: 'message_subagent',
      subAgentId: event.subAgentId,
    };

    const existingWorkingFlow = findWorkingFlowChunk(state);

    if (existingWorkingFlow) {
      const addChildOp = createAddChildOperation(existingWorkingFlow.id, {
        id: generateChildId(),
        subType: WorkingFlowSubType.AGENT_ACTION,
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
            subType: WorkingFlowSubType.AGENT_ACTION,
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
