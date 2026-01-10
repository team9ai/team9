import type {
  MemoryThread,
  QueuedEvent,
  LLMInteraction,
} from '../types/thread.types.js';
import type { MemoryState, StateProvenance } from '../types/state.types.js';
import type {
  AgentEvent,
  LLMResponseRequirement,
} from '../types/event.types.js';
import type {
  ReducerRegistry,
  ReducerResult,
} from '../reducer/reducer.types.js';
import type { StorageProvider } from '../storage/storage.types.js';
import type { ILLMAdapter, LLMConfig } from '../llm/llm.types.js';
import type {
  IMemoryManager,
  Step,
  CreateThreadOptions,
  CreateThreadResult,
} from './memory-manager.interface.js';
import { MemoryManagerImpl } from './memory-manager.impl.js';
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
import { StepLockManager } from './step-lock.manager.js';
import { EventQueueCoordinator } from './event-queue.coordinator.js';
import {
  StateTransitionManager,
  ApplyReducerResultOutput,
} from './state-transition.manager.js';
import { StepLifecycleManager } from './step-lifecycle.manager.js';
import {
  EventDispatcher,
  IEventDispatchCoordinator,
} from './event-dispatcher.js';

// Re-export for external use
export { StepLockManager } from './step-lock.manager.js';
export { EventQueueCoordinator } from './event-queue.coordinator.js';
export {
  StateTransitionManager,
  ApplyReducerResultOutput,
} from './state-transition.manager.js';
export { StepLifecycleManager } from './step-lifecycle.manager.js';
export {
  EventDispatcher,
  IEventDispatchCoordinator,
} from './event-dispatcher.js';

// Re-export types for backward compatibility
export type { StepResult, DispatchResult };

/**
 * Configuration for AgentOrchestrator
 */
export interface AgentOrchestratorConfig {
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
 * AgentOrchestrator is the main orchestrator for agent runtime
 * It coordinates between events, reducers, storage, and compaction
 *
 * Flow: Event → Persistent Queue → Process one at a time → New State
 *
 * Key constraint: Only one event can be processed at a time (serial processing)
 * This eliminates the need for complex blocking mechanisms
 *
 * Architecture:
 * - Uses IMemoryManager for pure data operations (Thread, State, Step, EventQueue)
 * - Implements runtime coordination directly (applyReducerResult, step locks, needsResponse)
 */
export class AgentOrchestrator implements IEventDispatchCoordinator {
  private memoryManager: IMemoryManager;
  private observerManager: ObserverManager;
  private compactionManager: CompactionManager;
  private executionModeController: ExecutionModeController;
  private eventProcessor: EventProcessor;
  private stepLockManager: StepLockManager;
  private eventQueueCoordinator: EventQueueCoordinator;
  private stateTransitionManager: StateTransitionManager;
  private stepLifecycleManager: StepLifecycleManager;
  private eventDispatcher: EventDispatcher;
  private config: AgentOrchestratorConfig;

  constructor(
    storage: StorageProvider,
    private reducerRegistry: ReducerRegistry,
    private llmAdapter: ILLMAdapter,
    config: AgentOrchestratorConfig,
  ) {
    // Create memory manager (pure data layer)
    this.memoryManager = new MemoryManagerImpl(storage);

    // TODO: 这里有一个是否要自动运行的问题
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

    this.stepLockManager = new StepLockManager(this.memoryManager);
    this.eventQueueCoordinator = new EventQueueCoordinator(
      this.memoryManager,
      this.observerManager,
    );
    this.stateTransitionManager = new StateTransitionManager(
      this.memoryManager,
    );
    this.stepLifecycleManager = new StepLifecycleManager(this.memoryManager);

    // EventProcessor now receives AgentOrchestrator (this) instead of ThreadManager
    this.eventProcessor = new EventProcessor(
      this, // Pass self for runtime coordination
      this.reducerRegistry,
      this.observerManager,
      this.compactionManager,
      this.executionModeController,
    );

    // EventDispatcher handles event dispatch logic with callback to this orchestrator
    this.eventDispatcher = new EventDispatcher(
      this.memoryManager,
      this.executionModeController,
      this.eventProcessor,
      this.eventQueueCoordinator,
      this, // Pass self as IEventDispatchCoordinator for callbacks
    );
  }

  // ============ Thread Operations (delegated to IMemoryManager) ============

  /**
   * Create a new thread with an initial state
   */
  async createThread(
    options?: CreateThreadOptions,
  ): Promise<CreateThreadResult> {
    return this.memoryManager.createThread(options);
  }

  /**
   * Get a thread by ID
   */
  async getThread(threadId: string): Promise<Readonly<MemoryThread> | null> {
    return this.memoryManager.getThread(threadId);
  }

  /**
   * Get the current state of a thread
   */
  async getCurrentState(
    threadId: string,
  ): Promise<Readonly<MemoryState> | null> {
    return this.memoryManager.getCurrentState(threadId);
  }

  /**
   * Get state history for a thread
   */
  async getStateHistory(threadId: string): Promise<Readonly<MemoryState>[]> {
    return this.memoryManager.getStateHistory(threadId);
  }

  /**
   * Delete a thread and all its associated data
   */
  async deleteThread(threadId: string): Promise<void> {
    // Clean up execution mode controller state
    this.executionModeController.cleanup(threadId);
    return this.memoryManager.deleteThread(threadId);
  }

  // ============ Event Dispatch (delegated to EventDispatcher) ============

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
    return this.eventDispatcher.dispatch(threadId, event);
  }

  /**
   * Dispatch multiple events sequentially
   */
  async dispatchAll(
    threadId: string,
    events: AgentEvent[],
  ): Promise<DispatchResult> {
    return this.eventDispatcher.dispatchAll(threadId, events);
  }

  /**
   * Process all events in the persistent queue (serially, one at a time)
   * Used in auto mode to immediately process all queued events
   */
  private async processAllQueuedEvents(
    threadId: string,
  ): Promise<DispatchResult> {
    return this.eventDispatcher.processAllQueuedEvents(threadId);
  }

  // ============ Compaction ============

  /**
   * Trigger compaction for the thread's WORKING_HISTORY.
   * Compaction is now delegated to the WorkingHistoryComponent operations.
   * Since processing is serial, no blocking is needed.
   */
  async triggerCompaction(threadId: string): Promise<DispatchResult> {
    return this.compactionManager.executeCompaction(
      threadId,
      this, // Pass self (AgentOrchestrator) for runtime coordination
      this.observerManager,
    );
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
      const thread = await this.memoryManager.getThread(threadId);
      const state = await this.memoryManager.getCurrentState(threadId);
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

    // Apply truncation operations
    const result = await this.applyReducerResult(threadId, {
      operations,
      chunks: [],
    });

    // Notify observers of truncation
    const previousState = await this.memoryManager.getCurrentState(threadId);
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
    const stepId = await this.acquireStepLock(threadId);

    try {
      const queueLength = await this.getPersistentQueueLength(threadId);
      const responseNeeded = await this.needLLMContinueResponse(threadId);

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
          this, // Pass self (AgentOrchestrator) for runtime coordination
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
          await this.needLLMContinueResponse(threadId);

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
      await this.releaseStepLock(threadId, stepId);
    }
  }

  // ============ Runtime Coordination: State Transitions (delegated to StateTransitionManager) ============

  /**
   * Apply a reducer result to a thread
   * Executes operations and updates the thread's current state
   * @param threadId - The thread ID
   * @param reducerResult - The result from a reducer
   * @returns The updated thread and new state
   */
  async applyReducerResult(
    threadId: string,
    reducerResult: ReducerResult,
  ): Promise<ApplyReducerResultOutput> {
    return this.stateTransitionManager.applyReducerResult(
      threadId,
      reducerResult,
    );
  }

  /**
   * Apply a reducer result to a thread with provenance tracking
   * Records the event, step, and operation that caused the state transition
   * @param threadId - The thread ID
   * @param reducerResult - The result from a reducer
   * @param provenance - Provenance information for traceability
   * @param llmResponseRequirement - Event's requirement for LLM response
   * @returns The updated thread and new state
   */
  async applyReducerResultWithProvenance(
    threadId: string,
    reducerResult: ReducerResult,
    provenance: StateProvenance,
    llmResponseRequirement: LLMResponseRequirement,
  ): Promise<ApplyReducerResultOutput> {
    return this.stateTransitionManager.applyReducerResultWithProvenance(
      threadId,
      reducerResult,
      provenance,
      llmResponseRequirement,
    );
  }

  // ============ Runtime Coordination: Step Lock (delegated to StepLockManager) ============

  /**
   * Acquire a step lock for processing
   * If the thread is already locked, throws an error
   * @param threadId - The thread ID
   * @returns The generated step ID
   */
  async acquireStepLock(threadId: string): Promise<string> {
    return this.stepLockManager.acquireStepLock(threadId);
  }

  /**
   * Release the step lock after processing completes
   * @param threadId - The thread ID
   * @param stepId - The step ID to release (must match current lock)
   */
  async releaseStepLock(threadId: string, stepId: string): Promise<void> {
    return this.stepLockManager.releaseStepLock(threadId, stepId);
  }

  /**
   * Check if the thread is currently locked for processing
   * @param threadId - The thread ID
   * @returns True if locked, false otherwise
   */
  async isStepLocked(threadId: string): Promise<boolean> {
    return this.stepLockManager.isStepLocked(threadId);
  }

  /**
   * Get the current step ID if locked
   * @param threadId - The thread ID
   * @returns The current step ID or null if not locked
   */
  async getCurrentStepId(threadId: string): Promise<string | null> {
    return this.stepLockManager.getCurrentStepId(threadId);
  }

  // ============ Runtime Coordination: LLM Response Check (delegated to StepLifecycleManager) ============

  /**
   * Check if the thread needs LLM to continue responding
   * This is determined by the event's llmResponseRequirement during state transition
   * @param threadId - The thread ID
   * @returns True if LLM should continue responding, false otherwise
   */
  async needLLMContinueResponse(threadId: string): Promise<boolean> {
    return this.stepLifecycleManager.needLLMContinueResponse(threadId);
  }

  // ============ Runtime Coordination: Step Lifecycle (delegated to StepLifecycleManager) ============

  /**
   * Create and save a new step record
   * @param threadId - The thread ID
   * @param stepId - The step ID
   * @param triggerEvent - The event that triggered this step
   * @param previousStateId - The state ID before this step
   * @param eventPayload - The full event payload for debugging
   * @returns The created step
   */
  async createStep(
    threadId: string,
    stepId: string,
    triggerEvent: { eventId?: string; type: string; timestamp: number },
    previousStateId?: string,
    eventPayload?: AgentEvent,
  ): Promise<Step> {
    return this.stepLifecycleManager.createStep(
      threadId,
      stepId,
      triggerEvent,
      previousStateId,
      eventPayload,
    );
  }

  /**
   * Complete a step successfully
   * @param stepId - The step ID
   * @param resultStateId - The resulting state ID
   */
  async completeStep(stepId: string, resultStateId: string): Promise<void> {
    return this.stepLifecycleManager.completeStep(stepId, resultStateId);
  }

  /**
   * Mark a step as failed
   * @param stepId - The step ID
   * @param error - The error message
   */
  async failStep(stepId: string, error: string): Promise<void> {
    return this.stepLifecycleManager.failStep(stepId, error);
  }

  // ============ Accessors ============

  /**
   * Get the underlying memory manager
   */
  getMemoryManager(): IMemoryManager {
    return this.memoryManager;
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

  // ============ Persistent Event Queue (delegated to EventQueueCoordinator) ============

  /**
   * Get the persistent event queue for a thread
   * This queue is persisted to storage and survives restarts
   */
  async getPersistentEventQueue(threadId: string): Promise<QueuedEvent[]> {
    return this.eventQueueCoordinator.getPersistentEventQueue(threadId);
  }

  /**
   * Push an event to the persistent queue
   * Notifies observers of the queue change
   */
  async pushEventToQueue(
    threadId: string,
    event: AgentEvent,
  ): Promise<QueuedEvent> {
    return this.eventQueueCoordinator.pushEventToQueue(threadId, event);
  }

  /**
   * Pop the first event from the persistent queue
   * Notifies observers of the queue change
   */
  async popEventFromQueue(threadId: string): Promise<QueuedEvent | null> {
    return this.eventQueueCoordinator.popEventFromQueue(threadId);
  }

  /**
   * Peek at the first event in the persistent queue without removing it
   */
  async peekPersistentEvent(threadId: string): Promise<QueuedEvent | null> {
    return this.eventQueueCoordinator.peekPersistentEvent(threadId);
  }

  /**
   * Get the number of events in the persistent queue
   */
  async getPersistentQueueLength(threadId: string): Promise<number> {
    return this.eventQueueCoordinator.getPersistentQueueLength(threadId);
  }

  /**
   * Clear all events from the persistent queue
   */
  async clearPersistentQueue(threadId: string): Promise<void> {
    return this.eventQueueCoordinator.clearPersistentQueue(threadId);
  }

  // ============ Step Operations (delegated to IMemoryManager) ============

  /**
   * Get a step by ID
   * @param stepId - The step ID
   * @returns The step or null if not found
   */
  async getStep(stepId: string): Promise<Step | null> {
    return this.memoryManager.getStep(stepId);
  }

  /**
   * Get all steps for a thread
   * @param threadId - The thread ID
   * @returns Array of steps ordered by start time
   */
  async getStepsByThread(threadId: string): Promise<Step[]> {
    return this.memoryManager.getStepsByThread(threadId);
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
    return this.memoryManager.updateStep(stepId, { llmInteraction });
  }

  // ============ Parent-Child Thread Operations (delegated to IMemoryManager) ============

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
    return this.memoryManager.addChildThread(parentThreadId, childThreadId);
  }

  /**
   * Get all child threads for a parent thread
   * @param parentThreadId - The parent thread ID
   * @returns Array of child threads
   */
  async getChildThreads(
    parentThreadId: string,
  ): Promise<Readonly<MemoryThread>[]> {
    return this.memoryManager.getChildThreads(parentThreadId);
  }

  /**
   * Get the parent thread for a child thread
   * @param childThreadId - The child thread ID
   * @returns The parent thread or null if not found or no parent
   */
  async getParentThread(
    childThreadId: string,
  ): Promise<Readonly<MemoryThread> | null> {
    return this.memoryManager.getParentThread(childThreadId);
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
    return this.memoryManager.removeChildThread(parentThreadId, childThreadId);
  }
}
