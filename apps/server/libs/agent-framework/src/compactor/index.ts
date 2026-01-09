/**
 * Compactor Module
 *
 * Provides coordinated compaction across components.
 *
 * Architecture:
 * - Compactor: Coordinator that identifies chunks needing compaction and delegates to components
 * - Component.compactChunk: Each component implements its own compaction logic
 *
 * Usage:
 * ```ts
 * const compactor = new Compactor(llmAdapter, { temperature: 0.3 });
 *
 * // Check which chunks need compaction
 * const chunksToCompact = compactor.getChunksToCompact(state);
 *
 * // Execute compaction
 * if (compactor.canCompact(state)) {
 *   const result = await compactor.compact(state);
 * }
 * ```
 */

export { Compactor } from './compactor.js';
export type {
  CompactorConfig,
  CompactableChunk,
  ComponentLookup,
} from './compactor.js';

// Re-export types from standard location
export type {
  CompactionResult,
  CompactionConfig,
} from '../types/compaction.types.js';
