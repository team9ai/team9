import { MemoryThread } from '../types/thread.types.js';
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
import { EventQueue, BlockingReason } from './event-queue.js';
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
import { EventProcessor } from './event-processor.js';

// Re-export StepResult for backward compatibility
export type { StepResult };

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
 * Flow: Event → Queue → ReducerRegistry → Operations + Chunks → ThreadManager → New State
 *
 * Blocking operations (like compaction) pause event processing until complete
 */
export class MemoryManager {
  private threadManager: ThreadManager;
  private eventQueues: Map<string, EventQueue<DispatchResult>> = new Map();
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

  // ============ Queue Management ============

  /**
   * Get or create event queue for a thread
   */
  private getQueue(threadId: string): EventQueue<DispatchResult> {
    let queue = this.eventQueues.get(threadId);
    if (!queue) {
      queue = new EventQueue<DispatchResult>();
      this.eventQueues.set(threadId, queue);
    }
    return queue;
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
    // Clear the queue
    const queue = this.eventQueues.get(threadId);
    if (queue) {
      queue.clear(new Error('Thread deleted'));
      this.eventQueues.delete(threadId);
    }

    // Clean up execution mode controller state
    this.executionModeController.cleanup(threadId);

    return this.threadManager.deleteThread(threadId);
  }

  // ============ Queue Status ============

  /**
   * Check if a thread is currently blocked
   */
  isBlocked(threadId: string): boolean {
    const queue = this.eventQueues.get(threadId);
    return queue?.isBlocked() ?? false;
  }

  /**
   * Get the blocking reason for a thread
   */
  getBlockingReason(threadId: string): BlockingReason | null {
    const queue = this.eventQueues.get(threadId);
    return queue?.getBlockingReason() ?? null;
  }

  /**
   * Get the number of queued events for a thread
   */
  getQueuedEventCount(threadId: string): number {
    const queue = this.eventQueues.get(threadId);
    return queue?.getQueueLength() ?? 0;
  }

  /**
   * Peek at the next event in the queue without processing it
   */
  peekNextEvent(threadId: string): AgentEvent | null {
    const queue = this.eventQueues.get(threadId);
    return queue?.peek() ?? null;
  }

  // ============ Event Dispatch ============

  /**
   * Dispatch an event to update memory state
   * Behavior depends on the event's dispatch strategy and current execution mode
   */
  async dispatch(threadId: string, event: AgentEvent): Promise<DispatchResult> {
    const queue = this.getQueue(threadId);
    const strategy =
      event.dispatchStrategy ?? getDefaultDispatchStrategy(event.type);
    const mode = this.executionModeController.getExecutionMode(threadId);

    // Handle different strategies
    switch (strategy) {
      case 'terminate':
        // Process the event, then mark thread as terminated
        // For now, process like queue but the reducer should handle termination
        return this.enqueueAndMaybeProcess(threadId, event, queue, mode);

      case 'interrupt':
        // TODO: Cancel current processing and immediately handle this event
        // For now, treat as queue (interrupt requires async cancellation support)
        return this.enqueueAndMaybeProcess(threadId, event, queue, mode);

      case 'silent':
        // Reserved for future: store only, no processing
        // For now, treat as queue
        return this.enqueueAndMaybeProcess(threadId, event, queue, mode);

      case 'queue':
      default:
        return this.enqueueAndMaybeProcess(threadId, event, queue, mode);
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
   * Enqueue event and process based on execution mode
   */
  private async enqueueAndMaybeProcess(
    threadId: string,
    event: AgentEvent,
    queue: EventQueue<DispatchResult>,
    mode: ExecutionMode,
  ): Promise<DispatchResult> {
    // If blocked for non-stepping reason (e.g., compacting), wait for enqueue
    if (
      queue.isBlocked() &&
      queue.getBlockingReason() !== BlockingReason.STEPPING
    ) {
      return queue.enqueue(event);
    }

    // In auto mode: process immediately with auto-compaction/truncation
    // In stepping mode: process immediately but queue compaction/truncation for next step
    if (mode === 'auto') {
      return this.processEvent(threadId, event);
    } else {
      // Stepping mode: ensure queue is blocked, then process event immediately
      // This creates a new state but queues compaction/truncation for step()
      if (!queue.isBlocked()) {
        queue.block(BlockingReason.STEPPING);
      }

      // Process the event immediately to create new state
      // (compaction/truncation will be queued, not executed)
      return this.processEventForStepping(threadId, event);
    }
  }

  /**
   * Process an event (internal, no queue check)
   * In auto mode, triggers background compaction and truncation if needed
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
      this.executeTruncation(threadId, chunksToTruncate).catch((error) => {
        console.error('Auto-truncation failed:', error);
      });
    }

    // In auto mode, check for pending compaction and trigger it
    const chunksToCompact =
      this.eventProcessor.consumePendingCompaction(threadId);
    if (chunksToCompact) {
      this.triggerCompaction(threadId, chunksToCompact).catch((error) => {
        console.error('Auto-compaction failed:', error);
      });
    }

    return result;
  }

  /**
   * Process an event in stepping mode (doesn't trigger auto-compaction immediately)
   */
  private async processEventForStepping(
    threadId: string,
    event: AgentEvent,
  ): Promise<DispatchResult> {
    return this.eventProcessor.processEvent(threadId, event, {
      steppingMode: true,
    });
  }

  // ============ Compaction ============

  /**
   * Trigger compaction for specific chunks
   * This blocks the event queue during compaction
   */
  async triggerCompaction(
    threadId: string,
    chunks?: MemoryChunk[],
  ): Promise<DispatchResult> {
    const queue = this.getQueue(threadId);

    // Block the queue
    const unblock = queue.block(BlockingReason.COMPACTING);

    try {
      // Get chunks to compact if not provided
      const chunksToCompact =
        chunks ??
        this.compactionManager.getCompressibleChunks(
          (await this.threadManager.getCurrentState(threadId))!,
        );

      return await this.compactionManager.executeCompaction(
        threadId,
        chunksToCompact,
        this.threadManager,
        this.observerManager,
      );
    } finally {
      // Unblock the queue
      unblock();

      // Process any queued events
      await queue.processQueue((event) => this.processEvent(threadId, event));
    }
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
   */
  async setExecutionMode(threadId: string, mode: ExecutionMode): Promise<void> {
    const queue = this.getQueue(threadId);
    await this.executionModeController.setExecutionMode(
      threadId,
      mode,
      queue,
      (tid, event) => this.processEvent(tid, event),
    );
  }

  /**
   * Initialize execution mode for a new thread
   */
  initializeExecutionMode(threadId: string, mode?: ExecutionMode): void {
    const queue = this.getQueue(threadId);
    this.executionModeController.initializeExecutionMode(threadId, mode, queue);
  }

  /**
   * Check if there's a pending compaction
   */
  hasPendingCompaction(threadId: string): boolean {
    return this.executionModeController.hasPendingCompaction(threadId);
  }

  /**
   * Execute a single step in stepping mode
   * In stepping mode, events are processed immediately on dispatch.
   * step() only executes pending compaction or truncation operations.
   */
  async step(threadId: string): Promise<StepResult> {
    const queue = this.getQueue(threadId);
    return this.executionModeController.step(
      threadId,
      queue,
      (tid, chunks) =>
        this.compactionManager.executeCompaction(
          tid,
          chunks,
          this.threadManager,
          this.observerManager,
        ),
      (tid, chunkIds) => this.executeTruncation(tid, chunkIds),
    );
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
}
