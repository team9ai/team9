/**
 * Working History Reducers
 * Reducer functions for conversation flow events
 */

import type { MemoryState } from '../../../types/state.types.js';
import { ChunkType } from '../../../types/chunk.types.js';
import type {
  BaseEvent,
  UserMessageEvent,
  ParentAgentMessageEvent,
  LLMTextResponseEvent,
  LLMToolCallEvent,
  LLMSkillCallEvent,
  LLMSubAgentSpawnEvent,
  LLMSubAgentMessageEvent,
  LLMClarificationEvent,
  ToolResultEvent,
  SkillResultEvent,
  SubAgentResultEvent,
  SubAgentErrorEvent,
} from '../../../types/event.types.js';
import type { ReducerResult } from '../../../reducer/reducer.types.js';
import { createConversationResult } from './working-history.operations.js';

// ============ Input Reducers ============

export function reduceUserMessage(
  componentKey: string,
  state: MemoryState,
  event: BaseEvent,
): ReducerResult {
  const e = event as UserMessageEvent;
  return createConversationResult({
    componentKey,
    state,
    chunkType: ChunkType.USER_MESSAGE,
    content: {
      text: e.content,
      attachments: e.attachments,
    },
    eventMeta: { eventType: e.type, timestamp: e.timestamp },
  });
}

export function reduceParentAgentMessage(
  componentKey: string,
  state: MemoryState,
  event: BaseEvent,
): ReducerResult {
  const e = event as ParentAgentMessageEvent;
  return createConversationResult({
    componentKey,
    state,
    chunkType: ChunkType.PARENT_MESSAGE,
    content: {
      text: e.content,
      parentAgentId: e.parentAgentId,
      taskContext: e.taskContext,
    },
    eventMeta: { eventType: e.type, timestamp: e.timestamp },
  });
}

// ============ LLM Response Reducers ============

export function reduceLLMTextResponse(
  componentKey: string,
  state: MemoryState,
  event: BaseEvent,
): ReducerResult {
  const e = event as LLMTextResponseEvent;
  return createConversationResult({
    componentKey,
    state,
    chunkType: ChunkType.AGENT_RESPONSE,
    content: {
      text: e.content,
      model: e.model,
      usage: e.usage,
    },
    eventMeta: { eventType: e.type, timestamp: e.timestamp },
  });
}

export function reduceLLMToolCall(
  componentKey: string,
  state: MemoryState,
  event: BaseEvent,
): ReducerResult {
  const e = event as LLMToolCallEvent;
  return createConversationResult({
    componentKey,
    state,
    chunkType: ChunkType.AGENT_ACTION,
    content: {
      text: `Tool call: ${e.toolName}`,
      action: 'tool_call',
      toolName: e.toolName,
      callId: e.callId,
      arguments: e.arguments,
      status: 'pending',
    },
    eventMeta: { eventType: e.type, timestamp: e.timestamp },
  });
}

export function reduceLLMSkillCall(
  componentKey: string,
  state: MemoryState,
  event: BaseEvent,
): ReducerResult {
  const e = event as LLMSkillCallEvent;
  return createConversationResult({
    componentKey,
    state,
    chunkType: ChunkType.AGENT_ACTION,
    content: {
      text: `Skill call: ${e.skillName}`,
      action: 'skill_call',
      skillName: e.skillName,
      callId: e.callId,
      input: e.input,
      status: 'pending',
    },
    eventMeta: { eventType: e.type, timestamp: e.timestamp },
  });
}

export function reduceLLMSubAgentSpawn(
  componentKey: string,
  state: MemoryState,
  event: BaseEvent,
): ReducerResult {
  const e = event as LLMSubAgentSpawnEvent;
  return createConversationResult({
    componentKey,
    state,
    chunkType: ChunkType.SUBAGENT_SPAWN,
    content: {
      text: `Spawned subagent "${e.agentType}" with task: ${e.task}`,
      subAgentId: e.subAgentId,
      agentType: e.agentType,
      task: e.task,
      config: e.config,
      status: 'running',
    },
    eventMeta: { eventType: e.type, timestamp: e.timestamp },
  });
}

export function reduceLLMSubAgentMessage(
  componentKey: string,
  state: MemoryState,
  event: BaseEvent,
): ReducerResult {
  const e = event as LLMSubAgentMessageEvent;
  return createConversationResult({
    componentKey,
    state,
    chunkType: ChunkType.AGENT_ACTION,
    content: {
      text: `Message to subagent: ${e.content}`,
      action: 'message_subagent',
      subAgentId: e.subAgentId,
    },
    eventMeta: { eventType: e.type, timestamp: e.timestamp },
  });
}

export function reduceLLMClarification(
  componentKey: string,
  state: MemoryState,
  event: BaseEvent,
): ReducerResult {
  const e = event as LLMClarificationEvent;
  return createConversationResult({
    componentKey,
    state,
    chunkType: ChunkType.AGENT_RESPONSE,
    content: {
      text: e.question,
      action: 'clarification',
      neededInfo: e.neededInfo,
    },
    eventMeta: { eventType: e.type, timestamp: e.timestamp },
  });
}

// ============ Result Reducers ============

export function reduceToolResult(
  componentKey: string,
  state: MemoryState,
  event: BaseEvent,
): ReducerResult {
  const e = event as ToolResultEvent;
  return createConversationResult({
    componentKey,
    state,
    chunkType: ChunkType.ACTION_RESPONSE,
    content: {
      text: `Tool result: ${e.toolName} (${e.success ? 'success' : 'error'})`,
      source: 'tool',
      toolName: e.toolName,
      callId: e.callId,
      result: e.result,
      success: e.success,
    },
    eventMeta: { eventType: e.type, timestamp: e.timestamp },
  });
}

export function reduceSkillResult(
  componentKey: string,
  state: MemoryState,
  event: BaseEvent,
): ReducerResult {
  const e = event as SkillResultEvent;
  return createConversationResult({
    componentKey,
    state,
    chunkType: ChunkType.ACTION_RESPONSE,
    content: {
      text: `Skill result: ${e.skillName} (${e.success ? 'success' : 'error'})`,
      source: 'skill',
      skillName: e.skillName,
      callId: e.callId,
      result: e.result,
      success: e.success,
    },
    eventMeta: { eventType: e.type, timestamp: e.timestamp },
  });
}

export function reduceSubAgentResult(
  componentKey: string,
  state: MemoryState,
  event: BaseEvent,
): ReducerResult {
  const e = event as SubAgentResultEvent;
  return createConversationResult({
    componentKey,
    state,
    chunkType: ChunkType.SUBAGENT_RESULT,
    content: {
      text: `Subagent result (${e.success ? 'success' : 'failed'})`,
      subAgentId: e.subAgentId,
      result: e.result,
      success: e.success,
    },
    eventMeta: { eventType: e.type, timestamp: e.timestamp },
  });
}

export function reduceSubAgentError(
  componentKey: string,
  state: MemoryState,
  event: BaseEvent,
): ReducerResult {
  const e = event as SubAgentErrorEvent;
  return createConversationResult({
    componentKey,
    state,
    chunkType: ChunkType.SUBAGENT_RESULT,
    content: {
      text: `Subagent error: ${e.error}`,
      subAgentId: e.subAgentId,
      error: e.error,
      errorDetails: e.errorDetails,
      success: false,
    },
    eventMeta: { eventType: e.type, timestamp: e.timestamp },
  });
}
