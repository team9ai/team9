/**
 * Compaction Types
 * Standard interface for component compaction operations
 */

import type { MemoryChunk } from './chunk.types.js';

/**
 * Result of a compaction operation
 */
export interface CompactionResult {
  /** The compacted chunk that replaces the original chunks */
  compactedChunk: MemoryChunk;
  /** IDs of chunks that were compacted */
  originalChunkIds: string[];
  /** Token count before compaction (estimated) */
  tokensBefore?: number;
  /** Token count after compaction (estimated) */
  tokensAfter?: number;
}

/**
 * Configuration for compaction operations
 */
export interface CompactionConfig {
  /** Temperature for LLM compaction (default: 0.3) */
  temperature?: number;
  /** Max tokens for compaction output (default: 2000) */
  maxTokens?: number;
}
