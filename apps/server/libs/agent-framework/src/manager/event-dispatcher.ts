import type { AgentEvent } from '../types/event.types.js';
import { getDefaultDispatchStrategy } from '../types/event.types.js';
import type { ExecutionMode } from '../blueprint/blueprint.types.js';
import type { IMemoryManager } from './memory-manager.interface.js';
import type { ExecutionModeController } from './execution-mode.controller.js';
import type { EventProcessor, DispatchResult } from './event-processor.js';
import type { EventQueueCoordinator } from './event-queue.coordinator.js';

/**
 * Interface for event dispatch coordination
 * Allows EventDispatcher to call back to the orchestrator for complex operations
 */
export interface IEventDispatchCoordinator {
  /** Execute truncation for specific chunks */
  executeTruncation(
    threadId: string,
    chunkIds: string[],
  ): Promise<DispatchResult>;
  /** Trigger compaction for the thread */
  triggerCompaction(threadId: string): Promise<DispatchResult>;
}

/**
 * EventDispatcher handles event dispatch and processing
 * Manages the event queue and processing flow
 */
export class EventDispatcher {
  constructor(
    private memoryManager: IMemoryManager,
    private executionModeController: ExecutionModeController,
    private eventProcessor: EventProcessor,
    private eventQueueCoordinator: EventQueueCoordinator,
    private coordinator: IEventDispatchCoordinator,
  ) {}

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
    await this.eventQueueCoordinator.pushEventToQueue(threadId, event);

    // In auto mode: process all queued events immediately (serially)
    if (mode === 'auto') {
      return this.processAllQueuedEvents(threadId);
    } else {
      // Stepping mode: just return current state, wait for step()
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

  /**
   * Process all events in the persistent queue (serially, one at a time)
   * Used in auto mode to immediately process all queued events
   *
   * Handles dispatch strategies:
   * - terminate: Stop processing after this event (end event loop)
   * - interrupt: Continue processing (interrupt flag is for LLM cancellation)
   * - queue/silent: Continue processing normally
   */
  async processAllQueuedEvents(threadId: string): Promise<DispatchResult> {
    let lastResult: DispatchResult | null = null;

    // Process events until queue is empty (one at a time)
    let queuedEvent =
      await this.eventQueueCoordinator.popEventFromQueue(threadId);
    while (queuedEvent) {
      lastResult = await this.processEvent(threadId, queuedEvent.event);

      // If this is a terminate-type event, stop processing further events
      if (lastResult.shouldTerminate) {
        break;
      }

      queuedEvent =
        await this.eventQueueCoordinator.popEventFromQueue(threadId);
    }

    if (!lastResult) {
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

    return lastResult;
  }

  /**
   * Process a single event
   * In auto mode, triggers compaction and truncation after processing
   */
  async processEvent(
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
      await this.coordinator.executeTruncation(threadId, chunksToTruncate);
    }

    // In auto mode, check for pending compaction and execute it
    const shouldCompact =
      this.eventProcessor.consumePendingCompaction(threadId);
    if (shouldCompact) {
      await this.coordinator.triggerCompaction(threadId);
    }

    return result;
  }
}
