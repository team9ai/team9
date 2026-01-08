/**
 * WorkingHistoryComponent - Core base component for conversation history management
 * Handles all events related to the conversation flow
 *
 * Architecture:
 * - WORKING_HISTORY chunk is a container that holds childIds (references to conversation chunks)
 * - Each conversation item (user message, agent response, etc.) is an independent chunk
 * - Child chunks use their own ChunkType (USER_MESSAGE, AGENT_RESPONSE, etc.)
 */

import { AbstractComponent } from '../abstract-component.js';
import type { MemoryChunk } from '../../../types/chunk.types.js';
import { ChunkType, ChunkContentType } from '../../../types/chunk.types.js';
import type { AgentEvent } from '../../../types/event.types.js';
import { EventType } from '../../../types/event.types.js';
import type {
  NewComponentType,
  ComponentContext,
  ComponentReducerFn,
  RenderedFragment,
} from '../../component.interface.js';
import {
  reduceUserMessage,
  reduceParentAgentMessage,
  reduceLLMTextResponse,
  reduceLLMToolCall,
  reduceLLMSkillCall,
  reduceLLMSubAgentSpawn,
  reduceLLMSubAgentMessage,
  reduceLLMClarification,
  reduceToolResult,
  reduceSkillResult,
  reduceSubAgentResult,
  reduceSubAgentError,
} from './working-history.reducers.js';

/**
 * WorkingHistoryComponent handles all conversation flow events
 * This is a base component that cannot be disabled
 */
export class WorkingHistoryComponent extends AbstractComponent {
  readonly id = 'core:working-history';
  readonly name = 'Working History';
  readonly type: NewComponentType = 'base';

  private static readonly HANDLED_EVENTS = new Set([
    EventType.USER_MESSAGE,
    EventType.PARENT_AGENT_MESSAGE,
    EventType.LLM_TEXT_RESPONSE,
    EventType.LLM_TOOL_CALL,
    EventType.LLM_SKILL_CALL,
    EventType.LLM_SUBAGENT_SPAWN,
    EventType.LLM_SUBAGENT_MESSAGE,
    EventType.LLM_CLARIFICATION,
    EventType.TOOL_RESULT,
    EventType.SKILL_RESULT,
    EventType.SUBAGENT_RESULT,
    EventType.SUBAGENT_ERROR,
  ]);

  getReducersForEvent(event: AgentEvent): ComponentReducerFn[] {
    if (!WorkingHistoryComponent.HANDLED_EVENTS.has(event.type)) {
      return [];
    }

    switch (event.type) {
      case EventType.USER_MESSAGE:
        return [(state, evt) => reduceUserMessage(this.id, state, evt)];
      case EventType.PARENT_AGENT_MESSAGE:
        return [(state, evt) => reduceParentAgentMessage(this.id, state, evt)];
      case EventType.LLM_TEXT_RESPONSE:
        return [(state, evt) => reduceLLMTextResponse(this.id, state, evt)];
      case EventType.LLM_TOOL_CALL:
        return [(state, evt) => reduceLLMToolCall(this.id, state, evt)];
      case EventType.LLM_SKILL_CALL:
        return [(state, evt) => reduceLLMSkillCall(this.id, state, evt)];
      case EventType.LLM_SUBAGENT_SPAWN:
        return [(state, evt) => reduceLLMSubAgentSpawn(this.id, state, evt)];
      case EventType.LLM_SUBAGENT_MESSAGE:
        return [(state, evt) => reduceLLMSubAgentMessage(this.id, state, evt)];
      case EventType.LLM_CLARIFICATION:
        return [(state, evt) => reduceLLMClarification(this.id, state, evt)];
      case EventType.TOOL_RESULT:
        return [(state, evt) => reduceToolResult(this.id, state, evt)];
      case EventType.SKILL_RESULT:
        return [(state, evt) => reduceSkillResult(this.id, state, evt)];
      case EventType.SUBAGENT_RESULT:
        return [(state, evt) => reduceSubAgentResult(this.id, state, evt)];
      case EventType.SUBAGENT_ERROR:
        return [(state, evt) => reduceSubAgentError(this.id, state, evt)];
      default:
        return [];
    }
  }

  // ============ Rendering ============

  renderChunk(
    chunk: MemoryChunk,
    _context: ComponentContext,
  ): RenderedFragment[] {
    // WORKING_HISTORY container is not directly rendered
    // It's used to track the order of conversation chunks
    if (chunk.type === ChunkType.WORKING_HISTORY) {
      return [];
    }

    // Render conversation chunks in the flow location
    const content = this.extractContent(chunk);
    const role = this.getRole(chunk.type);

    return [
      {
        content: `<${role}>\n${content}\n</${role}>`,
        location: 'flow' as const,
        order: chunk.metadata.createdAt, // Use creation time for ordering
      },
    ];
  }

  private getRole(chunkType: ChunkType): string {
    switch (chunkType) {
      case ChunkType.USER_MESSAGE:
      case ChunkType.PARENT_MESSAGE:
        return 'user';
      case ChunkType.AGENT_RESPONSE:
      case ChunkType.THINKING:
        return 'assistant';
      default:
        return 'system';
    }
  }

  private extractContent(chunk: MemoryChunk): string {
    const content = chunk.content;
    if (content.type === ChunkContentType.TEXT) {
      return (
        (content as { type: typeof ChunkContentType.TEXT; text: string })
          .text || ''
      );
    }
    return JSON.stringify(content);
  }
}
