import { MemoryChunk } from '../types/chunk.types';
import { MemoryState } from '../types/state.types';

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
 * Context provided to compactors for generating summaries
 */
export interface CompactionContext {
  /** Current memory state */
  state: MemoryState;
  /** The goal or objective of the current task (if available) */
  taskGoal?: string;
  /** Summary of what has been accomplished so far */
  progressSummary?: string;
}

/**
 * Interface for compactors that compress memory chunks
 */
export interface ICompactor {
  /**
   * Check if this compactor can handle the given chunks
   * @param chunks - Chunks to check
   * @returns true if this compactor can handle these chunks
   */
  canCompact(chunks: MemoryChunk[]): boolean;

  /**
   * Compact the given chunks into a smaller representation
   * @param chunks - Chunks to compact
   * @param context - Compaction context
   * @returns The compaction result
   */
  compact(
    chunks: MemoryChunk[],
    context: CompactionContext,
  ): Promise<CompactionResult>;
}
