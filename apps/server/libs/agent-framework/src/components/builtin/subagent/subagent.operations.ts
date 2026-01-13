/**
 * SubAgent Component Operations
 * Operations for creating subagent-related chunks
 */

import type { MemoryChunk } from '../../../types/chunk.types.js';
import {
  ChunkType,
  ChunkContentType,
  ChunkRetentionStrategy,
} from '../../../types/chunk.types.js';
import { createChunk } from '../../../factories/chunk.factory.js';

export const STATUS_CHUNK_KEY = 'subagent_status';

/**
 * Create status chunk for tracking active sub-agents
 */
export function createSubAgentStatusChunk(componentKey: string): MemoryChunk {
  return createChunk({
    componentKey,
    chunkKey: STATUS_CHUNK_KEY,
    type: ChunkType.SYSTEM,
    content: {
      type: ChunkContentType.TEXT,
      text: '',
      activeCount: 0,
    },
    retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
    custom: {
      isSubAgentStatus: true,
    },
  });
}
