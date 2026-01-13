import type { ExecutionMode } from '../blueprint/blueprint.types.js';

// DispatchResult is imported by memory.manager.ts - we use a forward reference here to avoid circular deps
// The actual DispatchResult type is defined in event-processor.ts and re-exported from memory.manager.ts
import type { DispatchResult } from './event-processor.js';

/**
 * Result of processNext() - the core event processing unit
 * Used by both step() (stepping mode) and auto mode processing
 */
export interface ProcessNextResult {
  /** The dispatch result, or null if nothing was done */
  dispatchResult: DispatchResult | null;
  /** Whether an event from the queue was processed */
  eventProcessed: boolean;
  /** Whether a compaction was performed */
  compactionPerformed: boolean;
  /** Whether a truncation was performed */
  truncationPerformed: boolean;
  /** Whether there are more pending operations (events in queue) */
  hasPendingOperations: boolean;
  /** Number of events remaining in the persistent queue */
  queuedEventCount: number;
  /** Whether the agent needs LLM to continue responding (set after user input) */
  needLLMContinueResponse?: boolean;
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
 * Result of a step operation (in stepping mode)
 * Same as ProcessNextResult - step() just adds mode checking
 */
export type StepResult = ProcessNextResult;

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
 * no blocking mechanism is needed. This controller just tracks execution mode per thread.
 *
 * Note: Compaction is now checked directly before processing events (not via pending state).
 * Truncation is handled non-destructively in TurnExecutor before LLM calls.
 */
export class ExecutionModeController {
  /** Tracks execution mode per thread */
  private executionModes: Map<string, ExecutionMode> = new Map();

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
   * Clean up state for a deleted thread
   */
  cleanup(threadId: string): void {
    this.executionModes.delete(threadId);
  }
}
