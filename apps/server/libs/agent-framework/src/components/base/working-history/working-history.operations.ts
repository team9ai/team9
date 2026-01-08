/**
 * Working History Operations
 * Shared utilities for working history management
 * Used by both WorkingHistoryComponent and ErrorComponent
 */

import type { MemoryChunk } from '../../../types/chunk.types.js';
import { ChunkType, ChunkContentType } from '../../../types/chunk.types.js';
import type { MemoryState } from '../../../types/state.types.js';
import type { ReducerResult } from '../../../reducer/reducer.types.js';
import { createChunk, deriveChunk } from '../../../factories/chunk.factory.js';
import {
  createAddOperation,
  createUpdateOperation,
} from '../../../factories/operation.factory.js';

const WORKING_HISTORY_KEY = 'history';

/**
 * Find the WORKING_HISTORY container chunk in state
 */
export function findWorkingHistoryChunk(
  state: MemoryState,
): MemoryChunk | undefined {
  for (const chunkId of state.chunkIds) {
    const chunk = state.chunks.get(chunkId);
    if (chunk?.type === ChunkType.WORKING_HISTORY) {
      return chunk;
    }
  }
  return undefined;
}

/**
 * Options for creating a conversation result
 */
export interface ConversationResultOptions {
  /** Component ID that owns this chunk */
  componentId: string;
  /** Memory state to update */
  state: MemoryState;
  /** Type of chunk to create */
  chunkType: ChunkType;
  /** Content for the chunk (will be merged with { type: TEXT }) */
  content: Record<string, unknown>;
  /** Event metadata */
  eventMeta: {
    eventType: string;
    timestamp: number;
  };
}

/**
 * Create a conversation chunk and add it to working history
 *
 * This creates a new chunk with the specified type and content,
 * then either:
 * - Adds it as a child to an existing WORKING_HISTORY container
 * - Creates a new WORKING_HISTORY container with this chunk as the first child
 */
export function createConversationResult(
  options: ConversationResultOptions,
): ReducerResult {
  const { componentId, state, chunkType, content, eventMeta } = options;

  // Create the conversation chunk
  const conversationChunk = createChunk({
    componentId,
    type: chunkType,
    content: {
      type: ChunkContentType.TEXT,
      ...content,
    },
    custom: {
      eventType: eventMeta.eventType,
      timestamp: eventMeta.timestamp,
    },
  });

  const existingHistory = findWorkingHistoryChunk(state);

  if (existingHistory) {
    // Update existing WORKING_HISTORY to add the new child ID
    const updatedHistory = deriveChunk(existingHistory, {
      parentIds: [existingHistory.id],
    });
    // Add the new child ID to the history chunk
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
      componentId,
      chunkKey: WORKING_HISTORY_KEY,
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
