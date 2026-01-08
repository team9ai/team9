/**
 * Todo Component Operations
 * Operations for creating and updating todo chunks
 */

import type { MemoryChunk } from '../../../types/chunk.types.js';
import {
  ChunkType,
  ChunkContentType,
  ChunkRetentionStrategy,
} from '../../../types/chunk.types.js';
import type { TodoItem } from '../../../types/event.types.js';
import type { MemoryState } from '../../../types/state.types.js';
import type { ReducerResult } from '../../../reducer/reducer.types.js';
import { createChunk, deriveChunk } from '../../../factories/chunk.factory.js';
import {
  createAddOperation,
  createUpdateOperation,
} from '../../../factories/operation.factory.js';

export const TODO_CHUNK_KEY = 'todo_list';

/**
 * Find the todo chunk in state
 */
export function findTodoChunk(
  componentId: string,
  state: MemoryState,
): MemoryChunk | undefined {
  for (const chunkId of state.chunkIds) {
    const chunk = state.chunks.get(chunkId);
    if (
      chunk?.componentId === componentId &&
      chunk.chunkKey === TODO_CHUNK_KEY
    ) {
      return chunk;
    }
  }
  return undefined;
}

/**
 * Create a new todo chunk
 */
export function createTodoChunk(
  componentId: string,
  todos: TodoItem[],
  formatFn: (todos: TodoItem[]) => string,
): MemoryChunk {
  return createChunk({
    componentId,
    chunkKey: TODO_CHUNK_KEY,
    type: ChunkType.SYSTEM,
    content: {
      type: ChunkContentType.TEXT,
      text: formatFn(todos),
      todos,
    },
    retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
    custom: {
      isTodoList: true,
    },
  });
}

/**
 * Create a reducer result for setting todos
 */
export function createTodoSetResult(
  componentId: string,
  state: MemoryState,
  todos: TodoItem[],
  formatFn: (todos: TodoItem[]) => string,
): ReducerResult {
  const todoChunk = findTodoChunk(componentId, state);

  if (!todoChunk) {
    // Create new chunk if not found
    const newChunk = createTodoChunk(componentId, todos, formatFn);
    return {
      operations: [createAddOperation(newChunk.id)],
      chunks: [newChunk],
    };
  }

  // Update existing chunk
  const updatedChunk = deriveChunk(todoChunk, {
    parentIds: [todoChunk.id],
  });
  const chunkWithContent: MemoryChunk = {
    ...updatedChunk,
    content: {
      type: ChunkContentType.TEXT,
      text: formatFn(todos),
      todos,
    },
  };

  return {
    operations: [createUpdateOperation(todoChunk.id, chunkWithContent.id)],
    chunks: [chunkWithContent],
  };
}

/**
 * Create a reducer result for updating todo chunk
 */
export function createTodoUpdateResult(
  componentId: string,
  state: MemoryState,
  todos: TodoItem[],
  formatFn: (todos: TodoItem[]) => string,
): ReducerResult {
  const todoChunk = findTodoChunk(componentId, state);
  if (!todoChunk) {
    return { operations: [], chunks: [] };
  }

  const updatedChunk = deriveChunk(todoChunk, {
    parentIds: [todoChunk.id],
  });
  const chunkWithContent: MemoryChunk = {
    ...updatedChunk,
    content: {
      type: ChunkContentType.TEXT,
      text: formatFn(todos),
      todos,
    },
  };

  return {
    operations: [createUpdateOperation(todoChunk.id, chunkWithContent.id)],
    chunks: [chunkWithContent],
  };
}
