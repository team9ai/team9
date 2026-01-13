import type { BaseEvent } from '../types/event.types.js';
import { EventDispatchStrategy } from '../types/event.types.js';
import type { ExecutionMode } from '../blueprint/blueprint.types.js';
import type { IMemoryManager } from './memory-manager.interface.js';
import type {
  ExecutionModeController,
  ProcessNextResult,
} from './execution-mode.controller.js';
import {
  CompactionCheckResult,
  type EventProcessor,
  type DispatchResult,
} from './event-processor.js';
import type { EventQueueCoordinator } from './event-queue.coordinator.js';
import type { CompactionManager } from './compaction.manager.js';
import type { StepLockManager } from './step-lock.manager.js';
import type { StepLifecycleManager } from './step-lifecycle.manager.js';
import type { StateTransitionManager } from './state-transition.manager.js';
import type { ObserverManager } from '../observer/observer.types.js';

// Re-export for backward compatibility
export type { ProcessNextResult };
export type StepResult = ProcessNextResult;

/**
 * EventDispatcher handles event dispatch and step execution
 * Owns the core processNextStep logic used by both auto and stepping modes
 *
 * Architecture:
 * - dispatch() / dispatchAll(): Entry points for events
 * - processNextStep(): Core processing unit (private)
 * - manualStep(): Public stepping mode entry point with lock
 * - processAllQueuedEvents(): Auto mode loop calling processNextStep
 */
export class EventDispatcher {
  constructor(
    private memoryManager: IMemoryManager,
    private executionModeController: ExecutionModeController,
    private eventQueueCoordinator: EventQueueCoordinator,
    private eventProcessor: EventProcessor,
    private compactionManager: CompactionManager,
    private stepLockManager: StepLockManager,
    private stepLifecycleManager: StepLifecycleManager,
    private observerManager: ObserverManager,
    private stateTransitionManager: StateTransitionManager,
  ) {}

  /**
   * Dispatch an event to the persistent queue
   * Events are always queued first, then processed based on execution mode
   *
   * Flow:
   * 1. Event is pushed to persistent queue
   * 2. In 'auto' mode: immediately process all queued events (one at a time)
   * 3. In 'stepping' mode: wait for manualStep() to be called
   */
  async dispatch(threadId: string, event: BaseEvent): Promise<DispatchResult> {
    // Default to QUEUE if not specified on the event
    const strategy = event.dispatchStrategy ?? EventDispatchStrategy.QUEUE;
    const mode = this.executionModeController.getExecutionMode(threadId);

    // Handle different strategies
    switch (strategy) {
      case EventDispatchStrategy.TERMINATE:
      case EventDispatchStrategy.INTERRUPT:
      case EventDispatchStrategy.SILENT:
      case EventDispatchStrategy.QUEUE:
      default:
        return this.enqueueAndMaybeProcess(threadId, event, mode);
    }
  }

  /**
   * Dispatch multiple events sequentially
   */
  async dispatchAll(
    threadId: string,
    events: BaseEvent[],
  ): Promise<DispatchResult> {
    let lastResult: DispatchResult | null = null;

    for (const event of events) {
      lastResult = await this.dispatch(threadId, event);
    }

    if (!lastResult) {
      return this.getEmptyDispatchResult(threadId);
    }

    return lastResult;
  }

  /**
   * Execute a single step manually in stepping mode
   * Wraps processNextStep() with stepping mode check and step lock
   *
   * @throws Error if not in stepping mode
   */
  async manualStep(threadId: string): Promise<StepResult> {
    const mode = this.executionModeController.getExecutionMode(threadId);
    if (mode !== 'stepping') {
      throw new Error(
        `Cannot step in '${mode}' mode. Set execution mode to 'stepping' first.`,
      );
    }

    // Acquire step lock
    const stepId = await this.stepLockManager.acquireStepLock(threadId);

    try {
      return await this.processNextStep(threadId);
    } finally {
      // Always release the step lock
      await this.stepLockManager.releaseStepLock(threadId, stepId);
    }
  }

  /**
   * Process all pending operations
   * Used in auto mode to immediately process all queued events
   *
   * Each call to processNextStep() handles:
   * - Compaction check (if needed, executes as separate operation)
   * - Event processing (pops from queue and processes)
   *
   * Handles dispatch strategies:
   * - terminate: Stop processing after this event (end event loop)
   * - interrupt: Continue processing (interrupt flag is for LLM cancellation)
   * - queue/silent: Continue processing normally
   *
   * Also respects execution mode changes: if mode switches to 'stepping'
   * during processing, stops and waits for manualStep() calls.
   */
  async processAllQueuedEvents(threadId: string): Promise<DispatchResult> {
    let lastResult: DispatchResult | null = null;

    // Process until no more operations to perform
    while (true) {
      // Check if execution mode has changed to stepping
      const currentMode =
        this.executionModeController.getExecutionMode(threadId);
      if (currentMode === 'stepping') {
        // Mode changed, stop auto processing and wait for manualStep() calls
        break;
      }

      const result = await this.processNextStep(threadId);

      // Track the last dispatch result
      if (result.dispatchResult) {
        lastResult = result.dispatchResult;
      }

      // Stop if a terminate-type event was processed
      if (result.shouldTerminate) {
        break;
      }

      // Stop if nothing was processed (no events and no compaction needed)
      if (!result.eventProcessed && !result.compactionPerformed) {
        break;
      }
    }

    // Return last result or empty result if nothing was processed
    if (!lastResult) {
      return this.getEmptyDispatchResult(threadId);
    }

    return lastResult;
  }

  // ============ Private Methods ============

  /**
   * Enqueue event to persistent queue and process based on execution mode
   */
  private async enqueueAndMaybeProcess(
    threadId: string,
    event: BaseEvent,
    mode: ExecutionMode,
  ): Promise<DispatchResult> {
    // Push event to persistent queue
    await this.eventQueueCoordinator.pushEventToQueue(threadId, event);

    // In auto mode: process all queued events immediately (serially)
    if (mode === 'auto') {
      return this.processAllQueuedEvents(threadId);
    } else {
      // Stepping mode: just return current state, wait for manualStep()
      return this.getEmptyDispatchResult(threadId);
    }
  }

  /**
   * Process the next step in the queue
   * This is the core event processing unit used by both manualStep() and auto mode
   *
   * Flow:
   * 1. Check if compaction is needed (based on token threshold)
   * 2. If compaction needed → execute and return (as independent operation)
   * 3. Check persistent queue for events
   * 4. If event exists → process and return
   * 5. If nothing to do → return empty result
   *
   * @param threadId - The thread ID
   */
  private async processNextStep(threadId: string): Promise<ProcessNextResult> {
    const queueLength =
      await this.eventQueueCoordinator.getPersistentQueueLength(threadId);
    const responseNeeded =
      await this.stepLifecycleManager.needLLMContinueResponse(threadId);

    // Step 1: Check if compaction is needed (based on token threshold)
    const currentState = await this.memoryManager.getCurrentState(threadId);
    if (currentState) {
      const compactionCheck =
        this.eventProcessor.checkCompactionNeeded(currentState);
      if (compactionCheck === CompactionCheckResult.FORCE) {
        // Execute compaction as this operation
        const result = await this.compactionManager.executeCompaction(
          threadId,
          this.memoryManager,
          this.stateTransitionManager,
          this.observerManager,
        );
        return {
          dispatchResult: result,
          eventProcessed: false,
          compactionPerformed: true,
          truncationPerformed: false,
          hasPendingOperations: queueLength > 0,
          queuedEventCount: queueLength,
          needLLMContinueResponse: responseNeeded,
        };
      }
    }

    // Step 2: Check persistent queue for events
    const queuedEvent =
      await this.eventQueueCoordinator.popEventFromQueue(threadId);

    if (!queuedEvent) {
      // Nothing to process
      return {
        dispatchResult: null,
        eventProcessed: false,
        compactionPerformed: false,
        truncationPerformed: false,
        hasPendingOperations: false,
        queuedEventCount: queueLength,
        needLLMContinueResponse: responseNeeded,
      };
    }

    // Step 3: Process the event
    const result = await this.eventProcessor.processEvent(
      threadId,
      queuedEvent.event,
    );

    const remainingCount =
      await this.eventQueueCoordinator.getPersistentQueueLength(threadId);
    const updatedResponseNeeded =
      await this.stepLifecycleManager.needLLMContinueResponse(threadId);

    // Check if compaction will be needed on next call
    const postEventState = await this.memoryManager.getCurrentState(threadId);
    const needsCompaction = postEventState
      ? this.eventProcessor.checkCompactionNeeded(postEventState) ===
        CompactionCheckResult.FORCE
      : false;

    return {
      dispatchResult: result,
      eventProcessed: true,
      compactionPerformed: false,
      truncationPerformed: false,
      hasPendingOperations: remainingCount > 0 || needsCompaction,
      queuedEventCount: remainingCount,
      needLLMContinueResponse: updatedResponseNeeded,
      shouldTerminate: result.shouldTerminate,
      shouldInterrupt: result.shouldInterrupt,
    };
  }

  /**
   * Get an empty dispatch result for cases where nothing was processed
   */
  private async getEmptyDispatchResult(
    threadId: string,
  ): Promise<DispatchResult> {
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
}
