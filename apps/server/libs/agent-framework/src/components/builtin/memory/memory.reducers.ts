/**
 * Memory Component Reducers
 * Reducer functions for memory management events
 */

import type { MemoryChunk } from '../../../types/chunk.types.js';
import { ChunkRetentionStrategy } from '../../../types/chunk.types.js';
import type { MemoryState } from '../../../types/state.types.js';
import type {
  AgentEvent,
  MemoryMarkCriticalEvent,
  MemoryForgetEvent,
} from '../../../types/event.types.js';
import type { ReducerResult } from '../../../reducer/reducer.types.js';
import type { ComponentContext } from '../../component.interface.js';
import { deriveChunk } from '../../../factories/chunk.factory.js';
import {
  createUpdateOperation,
  createDeleteOperation,
} from '../../../factories/operation.factory.js';

/**
 * Reduce MEMORY_MARK_CRITICAL event
 */
export function reduceMarkCritical(
  _componentId: string,
  state: MemoryState,
  event: AgentEvent,
  context: ComponentContext,
): ReducerResult {
  const memEvent = event as MemoryMarkCriticalEvent;
  const operations: ReducerResult['operations'] = [];
  const chunks: MemoryChunk[] = [];

  // Track critical chunks
  const criticalChunkIds =
    context.getData<Set<string>>('criticalChunkIds') ?? new Set();

  for (const chunkId of memEvent.chunkIds) {
    const chunk = state.chunks.get(chunkId);
    if (!chunk) continue;

    // Skip if already critical
    if (chunk.retentionStrategy === ChunkRetentionStrategy.CRITICAL) {
      continue;
    }

    // Update chunk to critical retention
    const updatedChunk = deriveChunk(chunk, {
      retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      parentIds: [chunk.id],
    });

    operations.push(createUpdateOperation(chunk.id, updatedChunk.id));
    chunks.push(updatedChunk);
    criticalChunkIds.add(updatedChunk.id);
  }

  context.setData('criticalChunkIds', criticalChunkIds);

  return { operations, chunks };
}

/**
 * Reduce MEMORY_FORGET event
 */
export function reduceForget(
  _componentId: string,
  state: MemoryState,
  event: AgentEvent,
  context: ComponentContext,
): ReducerResult {
  const memEvent = event as MemoryForgetEvent;
  const operations: ReducerResult['operations'] = [];

  // Track forgotten chunks
  const forgottenChunkIds =
    context.getData<Set<string>>('forgottenChunkIds') ?? new Set();
  const criticalChunkIds =
    context.getData<Set<string>>('criticalChunkIds') ?? new Set();

  for (const chunkId of memEvent.chunkIds) {
    const chunk = state.chunks.get(chunkId);
    if (!chunk) continue;

    // Don't allow forgetting critical chunks
    if (chunk.retentionStrategy === ChunkRetentionStrategy.CRITICAL) {
      continue;
    }

    operations.push(createDeleteOperation(chunkId));
    forgottenChunkIds.add(chunkId);
    criticalChunkIds.delete(chunkId);
  }

  context.setData('forgottenChunkIds', forgottenChunkIds);
  context.setData('criticalChunkIds', criticalChunkIds);

  return { operations, chunks: [] };
}
