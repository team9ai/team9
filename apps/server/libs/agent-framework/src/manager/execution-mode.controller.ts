import { MemoryChunk } from '../types/chunk.types.js';
import { AgentEvent } from '../types/event.types.js';
import type { ExecutionMode } from '../blueprint/blueprint.types.js';
import { EventQueue, BlockingReason } from './event-queue.js';
import type { DispatchResult } from './memory.manager.js';

/**
 * Result of a step operation
 */
export interface StepResult {
  /** The dispatch result, or null if nothing was done */
  dispatchResult: DispatchResult | null;
  /** Whether a compaction was performed */
  compactionPerformed: boolean;
  /** Whether a truncation was performed */
  truncationPerformed: boolean;
  /** Whether there are more pending operations (compaction or truncation) */
  hasPendingOperations: boolean;
}

/**
 * Configuration for ExecutionModeController
 */
export interface ExecutionModeControllerConfig {
  /** Default execution mode for new threads */
  defaultExecutionMode?: ExecutionMode;
}

/**
 * Callback for processing events
 */
export type EventProcessor = (
  threadId: string,
  event: AgentEvent,
) => Promise<DispatchResult>;

/**
 * Callback for executing compaction
 */
export type CompactionExecutor = (
  threadId: string,
  chunks: MemoryChunk[],
) => Promise<DispatchResult>;

/**
 * Callback for executing truncation
 */
export type TruncationExecutor = (
  threadId: string,
  chunkIds: string[],
) => Promise<DispatchResult>;

/**
 * ExecutionModeController manages execution mode and stepping logic
 * Extracted from MemoryManager for better separation of concerns
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
   * When switching to 'auto', processes all queued events
   * When switching to 'stepping', blocks the queue
   */
  async setExecutionMode(
    threadId: string,
    mode: ExecutionMode,
    queue: EventQueue<DispatchResult>,
    processEvent: EventProcessor,
  ): Promise<void> {
    const currentMode = this.getExecutionMode(threadId);
    if (currentMode === mode) {
      return;
    }

    this.executionModes.set(threadId, mode);

    if (mode === 'stepping') {
      // Enter stepping mode: block the queue
      if (!queue.isBlocked()) {
        queue.block(BlockingReason.STEPPING);
      }
    } else {
      // Enter auto mode: unblock and process queued events
      if (queue.getBlockingReason() === BlockingReason.STEPPING) {
        this.forceUnblockStepping(queue);
        // Process any queued events
        await queue.processQueue((event) => processEvent(threadId, event));
      }
    }
  }

  /**
   * Initialize execution mode for a new thread
   */
  initializeExecutionMode(
    threadId: string,
    mode: ExecutionMode | undefined,
    queue: EventQueue<DispatchResult>,
  ): void {
    const effectiveMode = mode ?? this.config.defaultExecutionMode ?? 'auto';
    this.executionModes.set(threadId, effectiveMode);

    if (effectiveMode === 'stepping') {
      if (!queue.isBlocked()) {
        queue.block(BlockingReason.STEPPING);
      }
    }
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
   * Execute a single step in stepping mode
   * In the new design, events are processed immediately on dispatch.
   * step() only executes pending compaction or truncation operations.
   */
  async step(
    threadId: string,
    queue: EventQueue<DispatchResult>,
    executeCompaction: CompactionExecutor,
    executeTruncation: TruncationExecutor,
  ): Promise<StepResult> {
    const mode = this.getExecutionMode(threadId);
    if (mode !== 'stepping') {
      throw new Error(
        `Cannot step in '${mode}' mode. Set execution mode to 'stepping' first.`,
      );
    }

    // Check for pending truncation first (truncation takes priority over compaction)
    const pendingTruncation = this.consumePendingTruncation(threadId);
    if (pendingTruncation) {
      // Temporarily unblock for truncation
      this.forceUnblockStepping(queue);

      try {
        const result = await executeTruncation(threadId, pendingTruncation);
        return {
          dispatchResult: result,
          compactionPerformed: false,
          truncationPerformed: true,
          hasPendingOperations:
            this.hasPendingCompaction(threadId) ||
            this.hasPendingTruncation(threadId),
        };
      } finally {
        // Re-block for stepping mode
        if (!queue.isBlocked()) {
          queue.block(BlockingReason.STEPPING);
        }
      }
    }

    // Check for pending compaction
    const pendingChunks = this.consumePendingCompaction(threadId);
    if (pendingChunks) {
      // Temporarily unblock for compaction
      this.forceUnblockStepping(queue);

      try {
        const result = await executeCompaction(threadId, pendingChunks);
        return {
          dispatchResult: result,
          compactionPerformed: true,
          truncationPerformed: false,
          hasPendingOperations:
            this.hasPendingCompaction(threadId) ||
            this.hasPendingTruncation(threadId),
        };
      } finally {
        // Re-block for stepping mode
        if (!queue.isBlocked()) {
          queue.block(BlockingReason.STEPPING);
        }
      }
    }

    // No pending operations
    return {
      dispatchResult: null,
      compactionPerformed: false,
      truncationPerformed: false,
      hasPendingOperations: false,
    };
  }

  /**
   * Force unblock a queue that's in STEPPING mode
   */
  forceUnblockStepping(queue: EventQueue<DispatchResult>): void {
    if (queue.getBlockingReason() === BlockingReason.STEPPING) {
      // Access private members to force unblock
      // TODO: Consider adding a proper unblock method to EventQueue
      (queue as any).blockingReason = null;
      if ((queue as any).unblockResolve) {
        (queue as any).unblockResolve();
        (queue as any).unblockResolve = null;
      }
      (queue as any).blockingPromise = null;
    }
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
