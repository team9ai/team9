/**
 * Error Component Operations
 * Operations for creating error-related chunks
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

/**
 * Options for creating a system error chunk
 */
export interface SystemErrorChunkOptions {
  componentId: string;
  code?: string;
  error: string;
  errorDetails?: unknown;
  eventType: string;
  timestamp: number;
}

/**
 * Create a system error chunk (standalone, not in working history)
 */
export function createSystemErrorChunk(
  options: SystemErrorChunkOptions,
): MemoryChunk {
  const { componentId, code, error, errorDetails, eventType, timestamp } =
    options;

  return createChunk({
    componentId,
    type: ChunkType.SYSTEM,
    content: {
      type: ChunkContentType.TEXT,
      errorType: 'system_error',
      code,
      error,
      errorDetails,
    },
    retentionStrategy: ChunkRetentionStrategy.CRITICAL,
    custom: {
      eventType,
      timestamp,
    },
  });
}

/**
 * Create a reducer result with a system error chunk
 */
export function createSystemErrorResult(
  options: SystemErrorChunkOptions,
): ReducerResult {
  const chunk = createSystemErrorChunk(options);
  return {
    operations: [createAddOperation(chunk.id)],
    chunks: [chunk],
  };
}
