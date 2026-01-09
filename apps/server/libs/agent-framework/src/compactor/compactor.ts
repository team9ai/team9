/**
 * Compactor
 * Coordinates compaction across components by:
 * 1. Identifying chunks that need compaction (getChunksToCompact)
 * 2. Delegating compaction to the component's compactChunk method
 *
 * Note: Component lookup is handled at a higher layer (e.g., ComponentManager).
 * Compactor receives the component reference when compacting.
 *
 * Current implementation:
 * - Directly returns WORKING_HISTORY chunk for compaction
 * - Logs warning and returns null if component not found or doesn't support compaction
 *
 * Future enhancements:
 * - Support weighted compaction priority across multiple chunk types
 * - Implement compaction scheduling based on memory pressure
 */

import type { MemoryChunk } from '../types/chunk.types.js';
import type { MemoryState } from '../types/state.types.js';
import type { CompactionResult } from '../types/compaction.types.js';
import type { ILLMAdapter } from '../llm/llm.types.js';
import type { ReducerResult } from '../reducer/reducer.types.js';
import type {
  IComponent,
  ComponentCompactionConfig,
  ComponentCompactionResult,
} from '../components/component.interface.js';
import {
  createCompactionResult,
  findWorkingHistoryChunk,
  hasCompressibleChunks,
} from '../components/base/working-history/index.js';

/**
 * Compactor configuration
 */
export interface CompactorConfig {
  /** Temperature for LLM compaction */
  temperature?: number;
  /** Max tokens for compaction output */
  maxTokens?: number;
}

/**
 * Chunk with compaction metadata
 * Used to track which chunks need compaction and their priority
 */
export interface CompactableChunk {
  /** The chunk to compact */
  chunk: MemoryChunk;
  /**
   * Compaction priority weight (higher = more urgent)
   * Future: calculate based on token count, age, retention strategy
   */
  weight?: number;
}

/**
 * Function to find component for a chunk
 * Provided by the caller (e.g., ComponentManager)
 */
export type ComponentLookup = (chunk: MemoryChunk) => IComponent | undefined;

/**
 * Compactor class - coordinates compaction across components
 *
 * Design:
 * - Compactor is responsible for WHEN to compact (identifying chunks)
 * - Component is responsible for HOW to compact (compactChunk method)
 * - Component lookup is delegated to external function (ComponentManager responsibility)
 *
 * Current implementation directly handles WORKING_HISTORY.
 * Future: iterate through components and call their compactChunk methods.
 */
export class Compactor {
  constructor(
    private llmAdapter: ILLMAdapter,
    private config: CompactorConfig = {},
  ) {}

  /**
   * Get chunks that need compaction from the state
   *
   * Current implementation: returns WORKING_HISTORY chunk if it has compressible children
   * Future: return weighted list of chunks from all components that support compaction
   *
   * @param state - Memory state to check
   * @returns Array of chunks that need compaction (currently max 1)
   */
  getChunksToCompact(state: MemoryState): CompactableChunk[] {
    const chunksToCompact: CompactableChunk[] = [];

    // Currently only check WORKING_HISTORY
    // Future: iterate through all component types and check their chunks
    const workingHistoryChunk = findWorkingHistoryChunk(state);
    if (workingHistoryChunk && hasCompressibleChunks(state)) {
      chunksToCompact.push({
        chunk: workingHistoryChunk,
        // Future: calculate weight based on token count, age, etc.
        weight: 1.0,
      });
    }

    return chunksToCompact;
  }

  /**
   * Check if compaction is possible for the given state
   * @param state - Memory state to check
   * @returns true if there are chunks that need compaction
   */
  canCompact(state: MemoryState): boolean {
    return this.getChunksToCompact(state).length > 0;
  }

  /**
   * Compact a specific chunk
   *
   * @param chunk - The chunk to compact
   * @param state - Current memory state
   * @param componentLookup - Function to find component for chunk (provided by ComponentManager)
   * @returns Compaction result, or null if compaction not supported
   */
  async compactChunk(
    chunk: MemoryChunk,
    state: MemoryState,
    componentLookup?: ComponentLookup,
  ): Promise<ComponentCompactionResult | null> {
    const config: ComponentCompactionConfig = {
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    };

    // Find component using provided lookup function
    const component = componentLookup?.(chunk);

    // Check if component was found
    if (!component) {
      console.warn(
        `[Compactor] No component found for chunk ${chunk.id} (type: ${chunk.type}). ` +
          `Ensure componentLookup is provided and the component is registered.`,
      );
      return null;
    }

    // Check if component supports compaction
    if (!component.compactChunk) {
      console.warn(
        `[Compactor] Component "${component.id}" does not implement compactChunk method. ` +
          `Skipping compaction for chunk ${chunk.id}.`,
      );
      return null;
    }

    // Delegate to component's compactChunk method
    return component.compactChunk(chunk, state, this.llmAdapter, config);
  }

  /**
   * Execute compaction on the state
   * Compacts the first (highest priority) chunk that needs compaction
   *
   * @param state - Memory state to compact
   * @param componentLookup - Function to find component for chunk (optional)
   * @returns Compaction result
   * @throws Error if no compactable chunks found
   */
  async compact(
    state: MemoryState,
    componentLookup?: ComponentLookup,
  ): Promise<CompactionResult> {
    const chunksToCompact = this.getChunksToCompact(state);

    if (chunksToCompact.length === 0) {
      throw new Error('No chunks available for compaction');
    }

    // Compact the first (highest priority) chunk
    // Future: sort by weight and handle multiple chunks
    const { chunk } = chunksToCompact[0];
    const result = await this.compactChunk(chunk, state, componentLookup);

    if (!result) {
      throw new Error(`Failed to compact chunk: ${chunk.id}`);
    }

    return result;
  }

  /**
   * Execute compaction and return reducer result for applying to state
   * @param state - Memory state to compact
   * @param componentLookup - Function to find component for chunk (optional)
   * @returns Reducer result with operations and chunks
   */
  async compactToReducerResult(
    state: MemoryState,
    componentLookup?: ComponentLookup,
  ): Promise<ReducerResult> {
    const result = await this.compact(state, componentLookup);
    return createCompactionResult(result);
  }
}
