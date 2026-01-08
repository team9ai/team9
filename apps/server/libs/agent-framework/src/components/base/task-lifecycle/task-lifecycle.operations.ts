/**
 * Task Lifecycle Operations
 * Operations for creating task lifecycle chunks
 */

import type { MemoryChunk } from '../../../types/chunk.types.js';
import {
  ChunkType,
  ChunkContentType,
  ChunkRetentionStrategy,
} from '../../../types/chunk.types.js';
import type { ReducerResult } from '../../../reducer/reducer.types.js';
import { createChunk } from '../../../factories/chunk.factory.js';
import { createAddOperation } from '../../../factories/operation.factory.js';

const OUTPUT_CHUNK_KEY = 'task_output';

/**
 * Options for creating a task output chunk
 */
export interface TaskOutputOptions {
  componentId: string;
  action: 'task_completed' | 'task_abandoned' | 'task_terminated';
  eventType: string;
  timestamp: number;
  status: string;
  content: Record<string, unknown>;
}

/**
 * Create a task output chunk
 */
export function createTaskOutputChunk(options: TaskOutputOptions): MemoryChunk {
  const { componentId, action, eventType, timestamp, status, content } =
    options;

  return createChunk({
    componentId,
    chunkKey: OUTPUT_CHUNK_KEY,
    type: ChunkType.OUTPUT,
    content: {
      type: ChunkContentType.TEXT,
      action,
      ...content,
    },
    retentionStrategy: ChunkRetentionStrategy.CRITICAL,
    custom: {
      eventType,
      timestamp,
      status,
    },
  });
}

/**
 * Create a reducer result with a task output chunk
 */
export function createTaskOutputResult(
  options: TaskOutputOptions,
): ReducerResult {
  const chunk = createTaskOutputChunk(options);
  return {
    operations: [createAddOperation(chunk.id)],
    chunks: [chunk],
  };
}
