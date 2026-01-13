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
import type { MemoryState } from '../../../types/state.types.js';
import type { BaseEvent } from '../../../types/event.types.js';
import { EventType } from '../../../types/event.types.js';
import type {
  TruncationContext,
  TruncationResult,
  TruncationStepResult,
  ITruncatableComponent,
} from '../../../types/truncation.types.js';
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
 * Implements ITruncatableComponent for context reduction
 */
export class WorkingHistoryComponent
  extends AbstractComponent
  implements ITruncatableComponent
{
  readonly id = 'core:working-history';
  readonly name = 'Working History';
  readonly type: NewComponentType = 'base';

  // ChunkTypes this component is responsible for (used by truncation)
  override readonly responsibleChunkTypes = [
    ChunkType.WORKING_HISTORY,
    ChunkType.USER_MESSAGE,
    ChunkType.AGENT_RESPONSE,
    ChunkType.THINKING,
    ChunkType.AGENT_ACTION,
    ChunkType.ACTION_RESPONSE,
    ChunkType.COMPACTED,
    ChunkType.SUBAGENT_SPAWN,
    ChunkType.SUBAGENT_RESULT,
    ChunkType.PARENT_MESSAGE,
  ];

  /**
   * Event types this component handles
   * These events will be routed to this component by the ReducerRegistry
   */
  override readonly supportedEventTypes = [
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
  ] as const;

  protected override getReducersForEventImpl(
    event: BaseEvent,
  ): ComponentReducerFn[] {
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

  // ============ Truncation (ITruncatableComponent) ============

  /**
   * Return the minimum/simplest version of working history
   * Keeps compacted summaries + last 5 messages
   */
  async minifyTruncate(
    ctx: TruncationContext,
  ): Promise<TruncationResult | null> {
    const ownedChunks = this.getOwnedChunks(ctx.state);
    const historyChunk = ownedChunks.find(
      (c) => c.type === ChunkType.WORKING_HISTORY,
    );
    if (!historyChunk) return null;

    const childIds = historyChunk.childIds ?? [];
    if (childIds.length <= 5) return null; // Already minimal

    // Keep compacted summaries + last 5 messages
    const compactedIds = childIds.filter((id) => {
      const chunk = ctx.state.chunks.get(id);
      return chunk?.type === ChunkType.COMPACTED;
    });
    const recentIds = childIds.slice(-5);

    const minimalChildIds = [...new Set([...compactedIds, ...recentIds])];

    // Calculate tokens reduced
    const removedIds = childIds.filter((id) => !minimalChildIds.includes(id));
    const tokensReduced = this.estimateTokensForChunkIds(ctx.state, removedIds);

    if (tokensReduced === 0) return null;

    return {
      truncatedChunks: [{ ...historyChunk, childIds: minimalChildIds }],
      tokensReduced,
    };
  }

  /**
   * Discard one piece of content (oldest non-compacted message)
   */
  async stepTruncate(
    ctx: TruncationContext,
  ): Promise<TruncationStepResult | null> {
    const ownedChunks = this.getOwnedChunks(ctx.state);
    const historyChunk = ownedChunks.find(
      (c) => c.type === ChunkType.WORKING_HISTORY,
    );
    if (!historyChunk?.childIds?.length) return null;

    const childIds = [...historyChunk.childIds];

    // Find oldest non-compacted chunk to remove
    let removedIndex = -1;
    for (let i = 0; i < childIds.length; i++) {
      const chunk = ctx.state.chunks.get(childIds[i]);
      if (chunk && chunk.type !== ChunkType.COMPACTED) {
        removedIndex = i;
        break;
      }
    }

    if (removedIndex === -1) return null; // Only compacted chunks left

    const removedId = childIds[removedIndex];
    childIds.splice(removedIndex, 1);

    const tokensReduced = this.estimateTokensForChunkIds(ctx.state, [
      removedId,
    ]);

    return {
      truncatedChunks: [{ ...historyChunk, childIds }],
      tokensReduced,
      canContinue: childIds.some((id) => {
        const chunk = ctx.state.chunks.get(id);
        return chunk && chunk.type !== ChunkType.COMPACTED;
      }),
    };
  }

  /**
   * Get weight for truncation priority (lower = discard first)
   * Working history has medium-low priority - can be truncated before system chunks
   */
  getTruncationWeight(_ctx: TruncationContext): number {
    return 50;
  }

  /**
   * Estimate tokens for a list of chunk IDs
   * Simple estimation: ~4 characters per token
   */
  private estimateTokensForChunkIds(
    state: MemoryState,
    chunkIds: string[],
  ): number {
    return chunkIds.reduce((sum, id) => {
      const chunk = state.chunks.get(id);
      if (!chunk) return sum;
      const text = this.extractContent(chunk);
      return sum + Math.ceil(text.length / 4);
    }, 0);
  }
}
