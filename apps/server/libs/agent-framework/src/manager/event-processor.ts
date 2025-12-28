import { MemoryThread } from '../types/thread.types.js';
import { MemoryState } from '../types/state.types.js';
import { MemoryChunk } from '../types/chunk.types.js';
import { AgentEvent } from '../types/event.types.js';
import { ReducerRegistry, ReducerResult } from '../reducer/reducer.types.js';
import { ThreadManager } from './thread.manager.js';
import type { ObserverManager } from '../observer/observer.types.js';
import type { CompactionManager } from './compaction.manager.js';
import type { ExecutionModeController } from './execution-mode.controller.js';

/**
 * Result of dispatching an event
 */
export interface DispatchResult {
  /** The updated thread */
  thread: Readonly<MemoryThread>;
  /** The new state after processing the event */
  state: Readonly<MemoryState>;
  /** Chunks that were added */
  addedChunks: MemoryChunk[];
  /** Chunk IDs that were removed */
  removedChunkIds: string[];
}

/**
 * Options for event processing
 */
export interface ProcessEventOptions {
  /** Whether this is stepping mode (doesn't trigger auto-compaction immediately) */
  steppingMode?: boolean;
}

/**
 * EventProcessor handles the core event processing logic
 * Extracted from MemoryManager for better separation of concerns
 */
export class EventProcessor {
  constructor(
    private threadManager: ThreadManager,
    private reducerRegistry: ReducerRegistry,
    private observerManager: ObserverManager,
    private compactionManager: CompactionManager,
    private executionModeController: ExecutionModeController,
  ) {}

  /**
   * Process an event and update memory state
   *
   * @param threadId - The thread ID
   * @param event - The event to process
   * @param options - Processing options
   * @returns The dispatch result
   */
  async processEvent(
    threadId: string,
    event: AgentEvent,
    options: ProcessEventOptions = {},
  ): Promise<DispatchResult> {
    const { steppingMode = false } = options;
    const startTime = Date.now();

    // Notify observers of event dispatch
    this.observerManager.notifyEventDispatch({
      threadId,
      event,
      timestamp: startTime,
    });

    // Get current state
    const currentState = await this.threadManager.getCurrentState(threadId);
    if (!currentState) {
      throw new Error(`Current state not found for thread: ${threadId}`);
    }

    // Run event through reducer registry
    const reducerResult = await this.executeReducer(
      threadId,
      event,
      currentState,
    );

    // If no operations, return current state unchanged
    if (reducerResult.operations.length === 0) {
      return this.createNoOpResult(threadId, currentState);
    }

    // Apply reducer result through thread manager
    const result = await this.threadManager.applyReducerResult(
      threadId,
      reducerResult,
    );

    // Notify observers of state change
    this.notifyStateChange(
      threadId,
      currentState,
      result.state,
      event,
      reducerResult,
      result.addedChunks,
      result.removedChunkIds,
    );

    // Handle auto-compaction based on mode
    this.handleAutoCompaction(threadId, result.state, steppingMode);

    return result;
  }

  /**
   * Execute reducer and notify observers
   */
  private async executeReducer(
    threadId: string,
    event: AgentEvent,
    currentState: Readonly<MemoryState>,
  ): Promise<ReducerResult> {
    const reducerStartTime = Date.now();
    const reducerResult = await this.reducerRegistry.reduce(
      currentState,
      event,
    );
    const reducerDuration = Date.now() - reducerStartTime;

    // Notify observers of reducer execution
    this.observerManager.notifyReducerExecute({
      threadId,
      reducerName: 'ReducerRegistry',
      inputEvent: event,
      inputState: currentState,
      result: reducerResult,
      logs: [],
      duration: reducerDuration,
    });

    return reducerResult;
  }

  /**
   * Create a no-op result when no operations are produced
   */
  private async createNoOpResult(
    threadId: string,
    currentState: Readonly<MemoryState>,
  ): Promise<DispatchResult> {
    const thread = await this.threadManager.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    return {
      thread,
      state: currentState,
      addedChunks: [],
      removedChunkIds: [],
    };
  }

  /**
   * Notify observers of state change
   */
  private notifyStateChange(
    threadId: string,
    previousState: Readonly<MemoryState>,
    newState: Readonly<MemoryState>,
    triggerEvent: AgentEvent,
    reducerResult: ReducerResult,
    addedChunks: MemoryChunk[],
    removedChunkIds: string[],
  ): void {
    this.observerManager.notifyStateChange({
      threadId,
      previousState,
      newState,
      triggerEvent,
      reducerName: 'ReducerRegistry',
      operations: reducerResult.operations,
      addedChunks,
      removedChunkIds,
    });
  }

  /**
   * Handle auto-compaction and truncation based on token thresholds
   */
  private handleAutoCompaction(
    threadId: string,
    state: Readonly<MemoryState>,
    steppingMode: boolean,
  ): void {
    const tokenCheck = this.compactionManager.checkTokenUsage(state);

    // Hard threshold (forceCompaction) triggers compaction
    if (tokenCheck.forceCompaction && tokenCheck.chunksToCompact.length > 0) {
      // Set pending compaction for both stepping and auto modes
      // In auto mode, MemoryManager will trigger it in the background
      // In stepping mode, it will be executed on next step
      this.executionModeController.setPendingCompaction(
        threadId,
        tokenCheck.chunksToCompact,
      );
    }

    // Set pending truncation if truncation threshold is exceeded
    if (tokenCheck.needsTruncation && tokenCheck.chunksToTruncate.length > 0) {
      this.executionModeController.setPendingTruncation(
        threadId,
        tokenCheck.chunksToTruncate,
      );
    }
  }

  /**
   * Check if auto-compaction was triggered and consume it
   * Used by MemoryManager to trigger background compaction in auto mode
   */
  consumePendingCompaction(threadId: string): MemoryChunk[] | null {
    return this.executionModeController.consumePendingCompaction(threadId);
  }

  /**
   * Check if truncation was triggered and consume it
   * Used by MemoryManager to trigger background truncation in auto mode
   */
  consumePendingTruncation(threadId: string): string[] | null {
    return this.executionModeController.consumePendingTruncation(threadId);
  }
}
