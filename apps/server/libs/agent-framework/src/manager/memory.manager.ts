import type {
  MemoryThread,
  QueuedEvent,
  LLMInteraction,
} from '../types/thread.types.js';
import { MemoryState } from '../types/state.types.js';
import { MemoryChunk } from '../types/chunk.types.js';
import {
  AgentEvent,
  getDefaultDispatchStrategy,
} from '../types/event.types.js';
import { ReducerRegistry } from '../reducer/reducer.types.js';
import { StorageProvider } from '../storage/storage.types.js';
import { ILLMAdapter, LLMConfig } from '../llm/llm.types.js';
import { ICompactor } from '../compactor/compactor.types.js';
import {
  ThreadManager,
  CreateThreadOptions,
  CreateThreadResult,
} from './thread.manager.js';
import type {
  MemoryObserver,
  ObserverManager,
} from '../observer/observer.types.js';
import { DefaultObserverManager } from '../observer/observer-manager.js';
import type { ExecutionMode } from '../blueprint/blueprint.types.js';
import { CompactionManager, TokenThresholds } from './compaction.manager.js';
import { createDeleteOperation } from '../factories/operation.factory.js';
import {
  ExecutionModeController,
  StepResult,
} from './execution-mode.controller.js';
import { EventProcessor, DispatchResult } from './event-processor.js';

// Re-export types for backward compatibility
export type { StepResult, DispatchResult };

/**
 * Configuration for MemoryManager
 */
export interface MemoryManagerConfig {
  /** LLM configuration for compaction */
  llm: LLMConfig;
  /** Whether to enable auto-compaction */
  autoCompactEnabled?: boolean;
  /** Token-based threshold configuration */
  tokenThresholds?: Partial<TokenThresholds>;
  /**
   * Default execution mode for new threads (default: 'auto')
   * - 'auto': Events are processed immediately
   * - 'stepping': Events are queued until step() is called
   */
  defaultExecutionMode?: ExecutionMode;
}

/**
 * MemoryManager is the main orchestrator for agent memory
 * It coordinates between events, reducers, storage, and compaction
 *
 * Flow: Event → Persistent Queue → Process one at a time → New State
 *
 * Key constraint: Only one event can be processed at a time (serial processing)
 * This eliminates the need for complex blocking mechanisms
 */
export class MemoryManager {
  private threadManager: ThreadManager;
  private observerManager: ObserverManager;
  private compactionManager: CompactionManager;
  private executionModeController: ExecutionModeController;
  private eventProcessor: EventProcessor;
  private config: MemoryManagerConfig;

  constructor(
    private storage: StorageProvider,
    private reducerRegistry: ReducerRegistry,
    private llmAdapter: ILLMAdapter,
    config: MemoryManagerConfig,
  ) {
    this.threadManager = new ThreadManager(storage);
    this.config = {
      autoCompactEnabled: true,
      defaultExecutionMode: 'auto',
      ...config,
    };
    this.observerManager = new DefaultObserverManager();

    // Initialize sub-managers
    this.compactionManager = new CompactionManager(llmAdapter, {
      llm: config.llm,
      autoCompactEnabled: this.config.autoCompactEnabled,
      tokenThresholds: this.config.tokenThresholds,
    });

    this.executionModeController = new ExecutionModeController({
      defaultExecutionMode: this.config.defaultExecutionMode,
    });

    this.eventProcessor = new EventProcessor(
      this.threadManager,
      this.reducerRegistry,
      this.observerManager,
      this.compactionManager,
      this.executionModeController,
    );
  }

  // ============ Thread Operations (delegated to ThreadManager) ============

  /**
   * Create a new thread with an initial state
   */
  async createThread(
    options?: CreateThreadOptions,
  ): Promise<CreateThreadResult> {
    return this.threadManager.createThread(options);
  }

  /**
   * Get a thread by ID
   */
  async getThread(threadId: string): Promise<Readonly<MemoryThread> | null> {
    return this.threadManager.getThread(threadId);
  }

  /**
   * Get the current state of a thread
   */
  async getCurrentState(
    threadId: string,
  ): Promise<Readonly<MemoryState> | null> {
    return this.threadManager.getCurrentState(threadId);
  }

  /**
   * Get state history for a thread
   */
  async getStateHistory(threadId: string): Promise<Readonly<MemoryState>[]> {
    return this.threadManager.getStateHistory(threadId);
  }

  /**
   * Delete a thread and all its associated data
   */
  async deleteThread(threadId: string): Promise<void> {
    // Clean up execution mode controller state
    this.executionModeController.cleanup(threadId);
    return this.threadManager.deleteThread(threadId);
  }

  // ============ Event Dispatch ============

  /**
   * Dispatch an event to the persistent queue
   * Events are always queued first, then processed based on execution mode
   *
   * Flow:
   * 1. Event is pushed to persistent queue
   * 2. In 'auto' mode: immediately process all queued events (one at a time)
   * 3. In 'stepping' mode: wait for step() to be called
   */
  async dispatch(threadId: string, event: AgentEvent): Promise<DispatchResult> {
    const strategy =
      event.dispatchStrategy ?? getDefaultDispatchStrategy(event.type);
    const mode = this.executionModeController.getExecutionMode(threadId);

    // Handle different strategies
    switch (strategy) {
      case 'terminate':
      case 'interrupt':
      case 'silent':
      case 'queue':
      default:
        return this.enqueueAndMaybeProcess(threadId, event, mode);
    }
  }

  /**
   * Dispatch multiple events sequentially
   */
  async dispatchAll(
    threadId: string,
    events: AgentEvent[],
  ): Promise<DispatchResult> {
    let lastResult: DispatchResult | null = null;

    for (const event of events) {
      lastResult = await this.dispatch(threadId, event);
    }

    if (!lastResult) {
      const thread = await this.threadManager.getThread(threadId);
      const state = await this.threadManager.getCurrentState(threadId);
      if (!thread || !state) {
        throw new Error(`Thread or state not found: ${threadId}`);
      }
      return {
        thread,
        state,
        addedChunks: [],
        removedChunkIds: [],
      };
    }

    return lastResult;
  }

  /**
   * Enqueue event to persistent queue and process based on execution mode
   */
  private async enqueueAndMaybeProcess(
    threadId: string,
    event: AgentEvent,
    mode: ExecutionMode,
  ): Promise<DispatchResult> {
    // Push event to persistent queue
    await this.pushEventToQueue(threadId, event);

    // In auto mode: process all queued events immediately (serially)
    if (mode === 'auto') {
      return this.processAllQueuedEvents(threadId);
    } else {
      // Stepping mode: just return current state, wait for step()
      const thread = await this.threadManager.getThread(threadId);
      const state = await this.threadManager.getCurrentState(threadId);
      if (!thread || !state) {
        throw new Error(`Thread or state not found: ${threadId}`);
      }
      return {
        thread,
        state,
        addedChunks: [],
        removedChunkIds: [],
      };
    }
  }

  /**
   * Process all events in the persistent queue (serially, one at a time)
   * Used in auto mode to immediately process all queued events
   *
   * Handles dispatch strategies:
   * - terminate: Stop processing after this event (end event loop)
   * - interrupt: Continue processing (interrupt flag is for LLM cancellation)
   * - queue/silent: Continue processing normally
   */
  private async processAllQueuedEvents(
    threadId: string,
  ): Promise<DispatchResult> {
    let lastResult: DispatchResult | null = null;

    // Process events until queue is empty (one at a time)
    let queuedEvent = await this.popEventFromQueue(threadId);
    while (queuedEvent) {
      lastResult = await this.processEvent(threadId, queuedEvent.event);

      // If this is a terminate-type event, stop processing further events
      if (lastResult.shouldTerminate) {
        break;
      }

      queuedEvent = await this.popEventFromQueue(threadId);
    }

    if (!lastResult) {
      const thread = await this.threadManager.getThread(threadId);
      const state = await this.threadManager.getCurrentState(threadId);
      if (!thread || !state) {
        throw new Error(`Thread or state not found: ${threadId}`);
      }
      return {
        thread,
        state,
        addedChunks: [],
        removedChunkIds: [],
      };
    }

    return lastResult;
  }

  /**
   * Process a single event
   * In auto mode, triggers compaction and truncation after processing
   */
  private async processEvent(
    threadId: string,
    event: AgentEvent,
  ): Promise<DispatchResult> {
    const result = await this.eventProcessor.processEvent(threadId, event, {
      steppingMode: false,
    });

    // In auto mode, check for pending truncation first (higher priority)
    const chunksToTruncate =
      this.eventProcessor.consumePendingTruncation(threadId);
    if (chunksToTruncate) {
      await this.executeTruncation(threadId, chunksToTruncate);
    }

    // In auto mode, check for pending compaction and execute it
    const chunksToCompact =
      this.eventProcessor.consumePendingCompaction(threadId);
    if (chunksToCompact) {
      await this.triggerCompaction(threadId, chunksToCompact);
    }

    return result;
  }

  // ============ Compaction ============

  /**
   * Trigger compaction for specific chunks
   * Since processing is serial, no blocking is needed
   */
  async triggerCompaction(
    threadId: string,
    chunks?: MemoryChunk[],
  ): Promise<DispatchResult> {
    // Get chunks to compact if not provided
    const chunksToCompact =
      chunks ??
      this.compactionManager.getCompressibleChunks(
        (await this.threadManager.getCurrentState(threadId))!,
      );

    return this.compactionManager.executeCompaction(
      threadId,
      chunksToCompact,
      this.threadManager,
      this.observerManager,
    );
  }

  /**
   * Register a custom compactor
   */
  registerCompactor(compactor: ICompactor): void {
    this.compactionManager.registerCompactor(compactor);
  }

  // ============ Truncation ============

  /**
   * Execute truncation for specific chunks
   * This removes the oldest WORKING_FLOW chunks when truncation threshold is exceeded
   */
  async executeTruncation(
    threadId: string,
    chunkIds: string[],
  ): Promise<DispatchResult> {
    if (chunkIds.length === 0) {
      const thread = await this.threadManager.getThread(threadId);
      const state = await this.threadManager.getCurrentState(threadId);
      if (!thread || !state) {
        throw new Error(`Thread or state not found: ${threadId}`);
      }
      return {
        thread,
        state,
        addedChunks: [],
        removedChunkIds: [],
      };
    }

    // Create delete operations for each chunk
    const operations = chunkIds.map((chunkId) =>
      createDeleteOperation(chunkId),
    );

    // Apply through thread manager
    const result = await this.threadManager.applyReducerResult(threadId, {
      operations,
      chunks: [],
    });

    // Notify observers of truncation
    const previousState = await this.threadManager.getCurrentState(threadId);
    this.observerManager.notifyStateChange({
      threadId,
      previousState: previousState!,
      newState: result.state,
      triggerEvent: null,
      reducerName: 'Truncation',
      operations,
      addedChunks: [],
      removedChunkIds: chunkIds,
    });

    return result;
  }

  /**
   * Check if there's a pending truncation
   */
  hasPendingTruncation(threadId: string): boolean {
    return this.executionModeController.hasPendingTruncation(threadId);
  }

  // ============ Execution Mode Control ============

  /**
   * Get the execution mode for a thread
   */
  getExecutionMode(threadId: string): ExecutionMode {
    return this.executionModeController.getExecutionMode(threadId);
  }

  /**
   * Set the execution mode for a thread
   * When switching from stepping to auto, processes all queued events
   */
  async setExecutionMode(threadId: string, mode: ExecutionMode): Promise<void> {
    const currentMode = this.executionModeController.getExecutionMode(threadId);

    this.executionModeController.setExecutionMode(threadId, mode);

    // When switching to auto mode, process all queued events
    if (currentMode === 'stepping' && mode === 'auto') {
      await this.processAllQueuedEvents(threadId);
    }
  }

  /**
   * Initialize execution mode for a new thread
   */
  initializeExecutionMode(threadId: string, mode?: ExecutionMode): void {
    this.executionModeController.initializeExecutionMode(threadId, mode);
  }

  /**
   * Check if there's a pending compaction
   */
  hasPendingCompaction(threadId: string): boolean {
    return this.executionModeController.hasPendingCompaction(threadId);
  }

  /**
   * Execute a single step in stepping mode
   * Uses a step lock to ensure only one step can be processed at a time
   *
   * Flow (based on flow diagram - CORRECT PRIORITY ORDER):
   * 1. Acquire step lock (throws if already locked)
   * 2. Check for pending truncation (HIGHEST PRIORITY - forced pre-event)
   * 3. Check for pending compaction (SECOND PRIORITY - forced pre-event)
   * 4. Check if there are events in the persistent queue
   * 5. If no events and no pending ops, check needsResponse flag
   * 6. Release step lock
   * 7. Return step result with queue status
   *
   * Priority Order:
   * 1. Pending truncation (must execute before events)
   * 2. Pending compaction (must execute before events)
   * 3. Events in queue
   * 4. LLM response generation (only if needsResponse is true)
   */
  async step(threadId: string): Promise<StepResult> {
    const mode = this.executionModeController.getExecutionMode(threadId);
    if (mode !== 'stepping') {
      throw new Error(
        `Cannot step in '${mode}' mode. Set execution mode to 'stepping' first.`,
      );
    }

    // Acquire step lock
    const stepId = await this.threadManager.acquireStepLock(threadId);

    try {
      const queueLength = await this.getPersistentQueueLength(threadId);
      const responseNeeded = await this.threadManager.needsResponse(threadId);

      // Step 1: Check for pending truncation FIRST (highest priority - forced pre-event)
      const pendingTruncation =
        this.executionModeController.consumePendingTruncation(threadId);
      if (pendingTruncation) {
        const result = await this.executeTruncation(
          threadId,
          pendingTruncation,
        );
        return {
          dispatchResult: result,
          eventProcessed: false,
          compactionPerformed: false,
          truncationPerformed: true,
          hasPendingOperations:
            queueLength > 0 ||
            this.executionModeController.hasPendingCompaction(threadId) ||
            this.executionModeController.hasPendingTruncation(threadId),
          queuedEventCount: queueLength,
          needsResponse: responseNeeded,
        };
      }

      // Step 2: Check for pending compaction SECOND (forced pre-event)
      const pendingCompaction =
        this.executionModeController.consumePendingCompaction(threadId);
      if (pendingCompaction) {
        const result = await this.compactionManager.executeCompaction(
          threadId,
          pendingCompaction,
          this.threadManager,
          this.observerManager,
        );
        return {
          dispatchResult: result,
          eventProcessed: false,
          compactionPerformed: true,
          truncationPerformed: false,
          hasPendingOperations:
            queueLength > 0 ||
            this.executionModeController.hasPendingCompaction(threadId) ||
            this.executionModeController.hasPendingTruncation(threadId),
          queuedEventCount: queueLength,
          needsResponse: responseNeeded,
        };
      }

      // Step 3: Check persistent queue for events
      const queuedEvent = await this.popEventFromQueue(threadId);

      if (queuedEvent) {
        // Process the event
        const result = await this.eventProcessor.processEvent(
          threadId,
          queuedEvent.event,
          { steppingMode: true },
        );

        const remainingCount = await this.getPersistentQueueLength(threadId);
        const updatedResponseNeeded =
          await this.threadManager.needsResponse(threadId);

        return {
          dispatchResult: result,
          eventProcessed: true,
          compactionPerformed: false,
          truncationPerformed: false,
          hasPendingOperations:
            remainingCount > 0 ||
            this.executionModeController.hasPendingCompaction(threadId) ||
            this.executionModeController.hasPendingTruncation(threadId),
          queuedEventCount: remainingCount,
          needsResponse: updatedResponseNeeded,
          // Pass through terminate/interrupt flags from the processed event
          shouldTerminate: result.shouldTerminate,
          shouldInterrupt: result.shouldInterrupt,
        };
      }

      // Step 4: No pending operations and no events in queue
      // Return empty step result (LLM response is handled by the caller based on needsResponse)
      return {
        dispatchResult: null,
        eventProcessed: false,
        compactionPerformed: false,
        truncationPerformed: false,
        hasPendingOperations: false,
        queuedEventCount: queueLength,
        needsResponse: responseNeeded,
      };
    } finally {
      // Always release the step lock
      await this.threadManager.releaseStepLock(threadId, stepId);
    }
  }

  /**
   * Check if the thread is currently processing a step
   */
  async isStepLocked(threadId: string): Promise<boolean> {
    return this.threadManager.isStepLocked(threadId);
  }

  /**
   * Get the current step ID if one is being processed
   */
  async getCurrentStepId(threadId: string): Promise<string | null> {
    return this.threadManager.getCurrentStepId(threadId);
  }

  // ============ Accessors ============

  /**
   * Get the underlying thread manager
   */
  getThreadManager(): ThreadManager {
    return this.threadManager;
  }

  /**
   * Get the reducer registry
   */
  getReducerRegistry(): ReducerRegistry {
    return this.reducerRegistry;
  }

  /**
   * Get the LLM adapter
   */
  getLLMAdapter(): ILLMAdapter {
    return this.llmAdapter;
  }

  // ============ Observer Management ============

  /**
   * Add an observer to receive memory events
   */
  addObserver(observer: MemoryObserver): () => void {
    return this.observerManager.addObserver(observer);
  }

  /**
   * Remove an observer
   */
  removeObserver(observer: MemoryObserver): void {
    this.observerManager.removeObserver(observer);
  }

  /**
   * Get the observer manager
   */
  getObserverManager(): ObserverManager {
    return this.observerManager;
  }

  // ============ Persistent Event Queue ============

  /**
   * Get the persistent event queue for a thread
   * This queue is persisted to storage and survives restarts
   */
  async getPersistentEventQueue(threadId: string): Promise<QueuedEvent[]> {
    return this.threadManager.getEventQueue(threadId);
  }

  /**
   * Push an event to the persistent queue
   * Notifies observers of the queue change
   */
  async pushEventToQueue(
    threadId: string,
    event: AgentEvent,
  ): Promise<QueuedEvent> {
    const queuedEvent = await this.threadManager.pushEvent(threadId, event);
    const queueLength = await this.threadManager.getEventQueueLength(threadId);

    // Notify observers
    this.observerManager.notifyEventQueued({
      threadId,
      queuedEvent,
      queueLength,
      timestamp: Date.now(),
    });

    return queuedEvent;
  }

  /**
   * Pop the first event from the persistent queue
   * Notifies observers of the queue change
   */
  async popEventFromQueue(threadId: string): Promise<QueuedEvent | null> {
    const queuedEvent = await this.threadManager.popEvent(threadId);
    if (!queuedEvent) {
      return null;
    }

    const queueLength = await this.threadManager.getEventQueueLength(threadId);

    // Notify observers
    this.observerManager.notifyEventDequeued({
      threadId,
      queuedEvent,
      queueLength,
      timestamp: Date.now(),
    });

    return queuedEvent;
  }

  /**
   * Peek at the first event in the persistent queue without removing it
   */
  async peekPersistentEvent(threadId: string): Promise<QueuedEvent | null> {
    return this.threadManager.peekEvent(threadId);
  }

  /**
   * Get the number of events in the persistent queue
   */
  async getPersistentQueueLength(threadId: string): Promise<number> {
    return this.threadManager.getEventQueueLength(threadId);
  }

  /**
   * Clear all events from the persistent queue
   */
  async clearPersistentQueue(threadId: string): Promise<void> {
    return this.threadManager.clearEventQueue(threadId);
  }

  // ============ Needs Response Flag ============

  /**
   * Check if the thread needs a response from the LLM
   * This is set to true after user input and false after LLM response
   */
  async needsResponse(threadId: string): Promise<boolean> {
    return this.threadManager.needsResponse(threadId);
  }

  /**
   * Set the needsResponse flag for a thread
   * Used by executor to clear the flag after generating a response
   */
  async setNeedsResponse(threadId: string, value: boolean): Promise<void> {
    return this.threadManager.setNeedsResponse(threadId, value);
  }

  // ============ Step Operations ============

  /**
   * Get a step by ID
   * @param stepId - The step ID
   * @returns The step or null if not found
   */
  async getStep(stepId: string) {
    return this.threadManager.getStep(stepId);
  }

  /**
   * Get all steps for a thread
   * @param threadId - The thread ID
   * @returns Array of steps ordered by start time
   */
  async getStepsByThread(threadId: string) {
    return this.threadManager.getStepsByThread(threadId);
  }

  /**
   * Update a step with LLM interaction data
   * Records what was sent to the LLM and what was received
   * @param stepId - The step ID
   * @param llmInteraction - The LLM interaction data
   */
  async updateStepLLMInteraction(
    stepId: string,
    llmInteraction: LLMInteraction,
  ): Promise<void> {
    return this.threadManager.updateStepLLMInteraction(stepId, llmInteraction);
  }

  // ============ Parent-Child Thread Operations ============

  /**
   * Add a child thread ID to a parent thread
   * Used when spawning subagents to track parent-child relationships
   * @param parentThreadId - The parent thread ID
   * @param childThreadId - The child thread ID to add
   */
  async addChildThread(
    parentThreadId: string,
    childThreadId: string,
  ): Promise<void> {
    return this.threadManager.addChildThread(parentThreadId, childThreadId);
  }

  /**
   * Get all child threads for a parent thread
   * @param parentThreadId - The parent thread ID
   * @returns Array of child threads
   */
  async getChildThreads(
    parentThreadId: string,
  ): Promise<Readonly<MemoryThread>[]> {
    return this.threadManager.getChildThreads(parentThreadId);
  }

  /**
   * Get the parent thread for a child thread
   * @param childThreadId - The child thread ID
   * @returns The parent thread or null if not found or no parent
   */
  async getParentThread(
    childThreadId: string,
  ): Promise<Readonly<MemoryThread> | null> {
    return this.threadManager.getParentThread(childThreadId);
  }

  /**
   * Remove a child thread ID from a parent thread
   * @param parentThreadId - The parent thread ID
   * @param childThreadId - The child thread ID to remove
   */
  async removeChildThread(
    parentThreadId: string,
    childThreadId: string,
  ): Promise<void> {
    return this.threadManager.removeChildThread(parentThreadId, childThreadId);
  }
}
