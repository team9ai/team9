/**
 * System Instructions Component Operations
 * Operations for creating system instruction chunks
 */

import type { MemoryChunk } from '../../../types/chunk.types.js';
import {
  ChunkType,
  ChunkContentType,
  ChunkRetentionStrategy,
} from '../../../types/chunk.types.js';
import { createChunk } from '../../../factories/chunk.factory.js';
import { hasTemplateExpressions } from '../../template-renderer.js';

export const SYSTEM_CHUNK_KEY = 'system_instructions';

/**
 * Create main instructions chunk
 */
export function createMainInstructionsChunk(
  componentKey: string,
  instructions: string,
): MemoryChunk {
  return createChunk({
    componentKey,
    chunkKey: SYSTEM_CHUNK_KEY,
    type: ChunkType.SYSTEM,
    content: {
      type: ChunkContentType.TEXT,
      text: instructions,
    },
    retentionStrategy: ChunkRetentionStrategy.CRITICAL,
    custom: {
      isMainInstructions: true,
      hasTemplates: hasTemplateExpressions(instructions),
    },
  });
}

/**
 * Create context section chunk
 */
export function createContextChunk(
  componentKey: string,
  key: string,
  value: string,
): MemoryChunk {
  return createChunk({
    componentKey,
    chunkKey: `context_${key}`,
    type: ChunkType.SYSTEM,
    content: {
      type: ChunkContentType.TEXT,
      text: value,
    },
    retentionStrategy: ChunkRetentionStrategy.CRITICAL,
    custom: {
      contextKey: key,
      hasTemplates: hasTemplateExpressions(value),
    },
  });
}
