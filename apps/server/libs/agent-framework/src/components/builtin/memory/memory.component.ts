/**
 * MemoryComponent - Manages memory retention and forgetting
 * Handles MEMORY_MARK_CRITICAL, MEMORY_FORGET events
 *
 * Architecture:
 * - Tracks which chunks are marked as critical
 * - Provides tools for marking/unmarking critical memory
 * - Does not create its own chunks, operates on other component's chunks
 */

import { AbstractComponent } from '../../base/abstract-component.js';
import type { MemoryChunk } from '../../../types/chunk.types.js';
import { ChunkRetentionStrategy } from '../../../types/chunk.types.js';
import type { MemoryState } from '../../../types/state.types.js';
import type { AgentEvent } from '../../../types/event.types.js';
import { EventType } from '../../../types/event.types.js';
import type {
  NewComponentType,
  ComponentContext,
  ComponentReducerFn,
  RenderedFragment,
} from '../../component.interface.js';
import type { MemoryStats } from './memory.types.js';
import { reduceMarkCritical, reduceForget } from './memory.reducers.js';

/**
 * MemoryComponent manages memory retention policies
 * This is a stable component (cannot be disabled at runtime)
 */
export class MemoryComponent extends AbstractComponent {
  readonly id = 'builtin:memory';
  readonly name = 'Memory Manager';
  readonly type: NewComponentType = 'stable';

  private static readonly HANDLED_EVENTS = new Set([
    EventType.MEMORY_MARK_CRITICAL,
    EventType.MEMORY_FORGET,
  ]);

  // ============ Lifecycle ============

  onInitialize(context: ComponentContext): void {
    // Track critical chunk IDs
    context.setData('criticalChunkIds', new Set<string>());
    // Track forgotten chunk IDs (for audit)
    context.setData('forgottenChunkIds', new Set<string>());
  }

  // ============ Chunk Management ============

  createInitialChunks(_context: ComponentContext): MemoryChunk[] {
    // This component doesn't create its own chunks
    return [];
  }

  // ============ Event Handling ============

  getReducersForEvent(event: AgentEvent): ComponentReducerFn[] {
    if (!MemoryComponent.HANDLED_EVENTS.has(event.type)) {
      return [];
    }

    switch (event.type) {
      case EventType.MEMORY_MARK_CRITICAL:
        return [
          (state, evt, ctx) => reduceMarkCritical(this.id, state, evt, ctx),
        ];
      case EventType.MEMORY_FORGET:
        return [(state, evt, ctx) => reduceForget(this.id, state, evt, ctx)];
      default:
        return [];
    }
  }

  // ============ Rendering ============

  renderChunk(
    _chunk: MemoryChunk,
    _context: ComponentContext,
  ): RenderedFragment[] {
    // This component doesn't render any chunks
    return [];
  }

  // ============ Public API ============

  /**
   * Check if a chunk is marked as critical
   */
  isCritical(context: ComponentContext, chunkId: string): boolean {
    const criticalChunkIds = context.getData<Set<string>>('criticalChunkIds');
    return criticalChunkIds?.has(chunkId) ?? false;
  }

  /**
   * Get all critical chunk IDs
   */
  getCriticalChunkIds(context: ComponentContext): string[] {
    const criticalChunkIds = context.getData<Set<string>>('criticalChunkIds');
    return criticalChunkIds ? Array.from(criticalChunkIds) : [];
  }

  /**
   * Get all forgotten chunk IDs (for audit)
   */
  getForgottenChunkIds(context: ComponentContext): string[] {
    const forgottenChunkIds = context.getData<Set<string>>('forgottenChunkIds');
    return forgottenChunkIds ? Array.from(forgottenChunkIds) : [];
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(context: ComponentContext, state: MemoryState): MemoryStats {
    let compressibleCount = 0;
    for (const chunk of state.chunks.values()) {
      if (chunk.retentionStrategy === ChunkRetentionStrategy.COMPRESSIBLE) {
        compressibleCount++;
      }
    }

    return {
      totalChunks: state.chunks.size,
      criticalChunks: this.getCriticalChunkIds(context).length,
      forgottenChunks: this.getForgottenChunkIds(context).length,
      compressibleChunks: compressibleCount,
    };
  }
}
