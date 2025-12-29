import { MemoryChunk } from '../types/chunk.types.js';
import type { ExecutionMode } from '../blueprint/blueprint.types.js';

// DispatchResult is imported by memory.manager.ts - we use a forward reference here to avoid circular deps
// The actual DispatchResult type is defined in event-processor.ts and re-exported from memory.manager.ts
import type { DispatchResult } from './event-processor.js';

/**
 * Result of a step operation
 */
export interface StepResult {
  /** The dispatch result, or null if nothing was done */
  dispatchResult: DispatchResult | null;
  /** Whether an event from the queue was processed */
  eventProcessed: boolean;
  /** Whether a compaction was performed */
  compactionPerformed: boolean;
  /** Whether a truncation was performed */
  truncationPerformed: boolean;
  /** Whether there are more pending operations (events in queue, compaction, or truncation) */
  hasPendingOperations: boolean;
  /** Number of events remaining in the persistent queue */
  queuedEventCount: number;
  /** Whether the agent needs to generate a response (set after user input) */
  needsResponse?: boolean;
  /**
   * Whether the agent should terminate (end event loop)
   * Set to true when a terminate-type event (TASK_COMPLETED, TASK_ABANDONED, TASK_TERMINATED) is processed
   */
  shouldTerminate?: boolean;
  /**
   * Whether to interrupt current LLM generation (if any)
   * Set to true when an interrupt-type event is processed
   * Note: Actual LLM cancellation is handled by the executor layer
   */
  shouldInterrupt?: boolean;
}

/**
 * Configuration for ExecutionModeController
 */
export interface ExecutionModeControllerConfig {
  /** Default execution mode for new threads */
  defaultExecutionMode?: ExecutionMode;
}

/**
 * ExecutionModeController manages execution mode and stepping logic
 *
 * Simplified design: Since processing is serial (one event at a time),
 * no blocking mechanism is needed. This controller just tracks:
 * - Execution mode per thread (auto vs stepping)
 * - Pending compaction/truncation for stepping mode
 */
export class ExecutionModeController {
  /** Tracks execution mode per thread */
  private executionModes: Map<string, ExecutionMode> = new Map();
  /** Tracks pending compaction per thread (for stepping mode) */
  private pendingCompaction: Map<string, MemoryChunk[]> = new Map();
  /** Tracks pending truncation per thread */
  private pendingTruncations: Map<string, string[]> = new Map();

  private config: ExecutionModeControllerConfig;

  constructor(config?: ExecutionModeControllerConfig) {
    this.config = {
      defaultExecutionMode: 'auto',
      ...config,
    };
  }

  /**
   * Get the execution mode for a thread
   */
  getExecutionMode(threadId: string): ExecutionMode {
    return (
      this.executionModes.get(threadId) ??
      this.config.defaultExecutionMode ??
      'auto'
    );
  }

  /**
   * Set the execution mode for a thread
   */
  setExecutionMode(threadId: string, mode: ExecutionMode): void {
    this.executionModes.set(threadId, mode);
  }

  /**
   * Initialize execution mode for a new thread
   */
  initializeExecutionMode(threadId: string, mode?: ExecutionMode): void {
    const effectiveMode = mode ?? this.config.defaultExecutionMode ?? 'auto';
    this.executionModes.set(threadId, effectiveMode);
  }

  /**
   * Check if there's a pending compaction
   */
  hasPendingCompaction(threadId: string): boolean {
    return this.pendingCompaction.has(threadId);
  }

  /**
   * Set pending compaction for next step
   */
  setPendingCompaction(threadId: string, chunks: MemoryChunk[]): void {
    this.pendingCompaction.set(threadId, chunks);
  }

  /**
   * Get and clear pending compaction
   */
  consumePendingCompaction(threadId: string): MemoryChunk[] | null {
    const chunks = this.pendingCompaction.get(threadId);
    if (chunks) {
      this.pendingCompaction.delete(threadId);
      return chunks;
    }
    return null;
  }

  /**
   * Check if there's a pending truncation
   */
  hasPendingTruncation(threadId: string): boolean {
    return this.pendingTruncations.has(threadId);
  }

  /**
   * Set pending truncation chunk IDs
   */
  setPendingTruncation(threadId: string, chunkIds: string[]): void {
    this.pendingTruncations.set(threadId, chunkIds);
  }

  /**
   * Get and clear pending truncation
   */
  consumePendingTruncation(threadId: string): string[] | null {
    const chunkIds = this.pendingTruncations.get(threadId);
    if (chunkIds) {
      this.pendingTruncations.delete(threadId);
      return chunkIds;
    }
    return null;
  }

  /**
   * Clean up state for a deleted thread
   */
  cleanup(threadId: string): void {
    this.executionModes.delete(threadId);
    this.pendingCompaction.delete(threadId);
    this.pendingTruncations.delete(threadId);
  }
}
