import type {
  MemoryThread,
  QueuedEvent,
  LLMInteraction,
} from '../types/thread.types.js';
import type { MemoryState, StateProvenance } from '../types/state.types.js';
import type { BaseEvent } from '../types/event.types.js';
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
import { ExecutionModeController } from './execution-mode.controller.js';
import { EventProcessor, DispatchResult } from './event-processor.js';
import { StepLockManager } from './step-lock.manager.js';
import { EventQueueCoordinator } from './event-queue.coordinator.js';
import {
  StateTransitionManager,
  ApplyReducerResultOutput,
} from './state-transition.manager.js';
import { StepLifecycleManager } from './step-lifecycle.manager.js';
import { EventDispatcher, type StepResult } from './event-dispatcher.js';

// Re-export for external use
export { StepLockManager } from './step-lock.manager.js';
export { EventQueueCoordinator } from './event-queue.coordinator.js';
export {
  StateTransitionManager,
  ApplyReducerResultOutput,
  type IStateTransitionManager,
} from './state-transition.manager.js';
export { StepLifecycleManager } from './step-lifecycle.manager.js';
export { EventDispatcher } from './event-dispatcher.js';

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
export class AgentOrchestrator {
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

    // EventProcessor receives specific managers instead of AgentOrchestrator
    this.eventProcessor = new EventProcessor(
      this.memoryManager,
      this.stateTransitionManager,
      this.stepLockManager,
      this.stepLifecycleManager,
      this.reducerRegistry,
      this.observerManager,
      this.compactionManager,
    );

    // EventDispatcher owns the core step processing logic
    // Both auto mode and stepping mode use the same processNextStep() inside EventDispatcher
    this.eventDispatcher = new EventDispatcher(
      this.memoryManager,
      this.executionModeController,
      this.eventQueueCoordinator,
      this.eventProcessor,
      this.compactionManager,
      this.stepLockManager,
      this.stepLifecycleManager,
      this.observerManager,
      this.stateTransitionManager,
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
  async dispatch(threadId: string, event: BaseEvent): Promise<DispatchResult> {
    return this.eventDispatcher.dispatch(threadId, event);
  }

  /**
   * Dispatch multiple events sequentially
   */
  async dispatchAll(
    threadId: string,
    events: BaseEvent[],
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
      this.memoryManager,
      this.stateTransitionManager,
      this.observerManager,
    );
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
   * Execute a single step manually in stepping mode
   * Delegates to EventDispatcher which owns the step processing logic
   *
   * @throws Error if not in stepping mode
   */
  async manualStep(threadId: string): Promise<StepResult> {
    return this.eventDispatcher.manualStep(threadId);
  }

  // ============ Runtime Coordination: Step Lock (delegated to StepLockManager) ============

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
    event: BaseEvent,
  ): Promise<QueuedEvent> {
    return this.eventQueueCoordinator.pushEventToQueue(threadId, event);
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
