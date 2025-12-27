import { MemoryThread } from '../types/thread.types.js';
import { MemoryState } from '../types/state.types.js';
import {
  MemoryChunk,
  ChunkType,
  ChunkRetentionStrategy,
} from '../types/chunk.types.js';
import {
  AgentEvent,
  getDefaultDispatchStrategy,
} from '../types/event.types.js';
import { ReducerRegistry } from '../reducer/reducer.types.js';
import { StorageProvider } from '../storage/storage.types.js';
import { ILLMAdapter, LLMConfig } from '../llm/llm.types.js';
import { ICompactor, CompactionContext } from '../compactor/compactor.types.js';
import { WorkingFlowCompactor } from '../compactor/working-flow.compactor.js';
import {
  ThreadManager,
  CreateThreadOptions,
  CreateThreadResult,
} from './thread.manager.js';
import { EventQueue, BlockingReason } from './event-queue.js';
import { createBatchReplaceOperation } from '../factories/operation.factory.js';
import type {
  MemoryObserver,
  ObserverManager,
} from '../observer/observer.types.js';
import { DefaultObserverManager } from '../observer/observer-manager.js';
import type { ExecutionMode } from '../blueprint/blueprint.types.js';

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
  /** Auto-compaction threshold (number of compressible chunks) */
  autoCompactThreshold?: number;
  /** Whether to enable auto-compaction */
  autoCompactEnabled?: boolean;
  /**
   * Default execution mode for new threads (default: 'auto')
   * - 'auto': Events are processed immediately
   * - 'stepping': Events are queued until step() is called
   */
  defaultExecutionMode?: ExecutionMode;
}

/**
 * Result of a step operation
 */
export interface StepResult {
  /** The dispatch result, or null if no event was processed */
  dispatchResult: DispatchResult | null;
  /** Whether a compaction was performed */
  compactionPerformed: boolean;
  /** Number of remaining events in the queue */
  remainingEvents: number;
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
  private compactors: ICompactor[] = [];
  private config: MemoryManagerConfig;
  private observerManager: ObserverManager;
  /** Tracks execution mode per thread */
  private executionModes: Map<string, ExecutionMode> = new Map();
  /** Tracks pending compaction per thread (for stepping mode) */
  private pendingCompaction: Map<string, MemoryChunk[]> = new Map();

  constructor(
    private storage: StorageProvider,
    private reducerRegistry: ReducerRegistry,
    private llmAdapter: ILLMAdapter,
    config: MemoryManagerConfig,
  ) {
    this.threadManager = new ThreadManager(storage);
    this.config = {
      autoCompactThreshold: 20,
      autoCompactEnabled: true,
      defaultExecutionMode: 'auto',
      ...config,
    };
    this.observerManager = new DefaultObserverManager();

    // Initialize default compactors
    this.compactors.push(new WorkingFlowCompactor(llmAdapter, config.llm));
  }

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

  /**
   * Create a new thread with an initial state
   * @param options - Options for thread creation
   * @returns The created thread and its initial state
   */
  async createThread(
    options?: CreateThreadOptions,
  ): Promise<CreateThreadResult> {
    return this.threadManager.createThread(options);
  }

  /**
   * Get a thread by ID
   * @param threadId - The thread ID
   * @returns The thread or null if not found
   */
  async getThread(threadId: string): Promise<Readonly<MemoryThread> | null> {
    return this.threadManager.getThread(threadId);
  }

  /**
   * Get the current state of a thread
   * @param threadId - The thread ID
   * @returns The current state or null if not found
   */
  async getCurrentState(
    threadId: string,
  ): Promise<Readonly<MemoryState> | null> {
    return this.threadManager.getCurrentState(threadId);
  }

  /**
   * Get state history for a thread
   * @param threadId - The thread ID
   * @returns Array of states ordered by creation time
   */
  async getStateHistory(threadId: string): Promise<Readonly<MemoryState>[]> {
    return this.threadManager.getStateHistory(threadId);
  }

  /**
   * Check if a thread is currently blocked
   * @param threadId - The thread ID
   */
  isBlocked(threadId: string): boolean {
    const queue = this.eventQueues.get(threadId);
    return queue?.isBlocked() ?? false;
  }

  /**
   * Get the blocking reason for a thread
   * @param threadId - The thread ID
   */
  getBlockingReason(threadId: string): BlockingReason | null {
    const queue = this.eventQueues.get(threadId);
    return queue?.getBlockingReason() ?? null;
  }

  /**
   * Dispatch an event to update memory state
   * Behavior depends on the event's dispatch strategy and current execution mode
   *
   * @param threadId - The thread ID
   * @param event - The event to process
   * @returns The result of processing the event
   */
  async dispatch(threadId: string, event: AgentEvent): Promise<DispatchResult> {
    const queue = this.getQueue(threadId);
    const strategy =
      event.dispatchStrategy ?? getDefaultDispatchStrategy(event.type);
    const mode = this.getExecutionMode(threadId);

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
   * Enqueue event and process based on execution mode
   */
  private async enqueueAndMaybeProcess(
    threadId: string,
    event: AgentEvent,
    queue: EventQueue<DispatchResult>,
    mode: ExecutionMode,
  ): Promise<DispatchResult> {
    // If blocked (e.g., compacting), always enqueue
    if (queue.isBlocked()) {
      return queue.enqueue(event);
    }

    // In auto mode: process immediately
    // In stepping mode: enqueue and wait for step()
    if (mode === 'auto') {
      return this.processEvent(threadId, event);
    } else {
      // Stepping mode: block queue if not already, then enqueue
      if (!queue.isBlocked()) {
        queue.block(BlockingReason.STEPPING);
      }
      return queue.enqueue(event);
    }
  }

  /**
   * Process an event (internal, no queue check)
   */
  private async processEvent(
    threadId: string,
    event: AgentEvent,
  ): Promise<DispatchResult> {
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
    const reducerStartTime = Date.now();
    const reducerResult = await this.reducerRegistry.reduce(
      currentState,
      event,
    );
    const reducerDuration = Date.now() - reducerStartTime;

    // Notify observers of reducer execution
    this.observerManager.notifyReducerExecute({
      threadId,
      reducerName: 'ReducerRegistry', // TODO: Get actual reducer name
      inputEvent: event,
      inputState: currentState,
      result: reducerResult,
      logs: [], // TODO: Capture reducer logs
      duration: reducerDuration,
    });

    // If no operations, return current state unchanged
    if (reducerResult.operations.length === 0) {
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

    // Apply reducer result through thread manager
    const result = await this.threadManager.applyReducerResult(
      threadId,
      reducerResult,
    );

    // Notify observers of state change
    this.observerManager.notifyStateChange({
      threadId,
      previousState: currentState,
      newState: result.state,
      triggerEvent: event,
      reducerName: 'ReducerRegistry', // TODO: Get actual reducer name
      operations: reducerResult.operations,
      addedChunks: result.addedChunks,
      removedChunkIds: result.removedChunkIds,
    });

    // Check if auto-compaction is needed
    if (this.config.autoCompactEnabled) {
      await this.checkAutoCompaction(threadId, result.state);
    }

    return result;
  }

  /**
   * Check if auto-compaction should be triggered
   */
  private async checkAutoCompaction(
    threadId: string,
    state: MemoryState,
  ): Promise<void> {
    const compressibleChunks = this.getCompressibleChunks(state);
    const threshold = this.config.autoCompactThreshold ?? 20;

    if (compressibleChunks.length >= threshold) {
      // Trigger auto-compaction in the background
      this.triggerCompaction(threadId, compressibleChunks).catch((error) => {
        console.error('Auto-compaction failed:', error);
      });
    }
  }

  /**
   * Get compressible chunks from state
   */
  private getCompressibleChunks(state: MemoryState): MemoryChunk[] {
    return Array.from(state.chunks.values()).filter(
      (chunk) =>
        chunk.type === ChunkType.WORKING_FLOW &&
        (chunk.retentionStrategy === ChunkRetentionStrategy.COMPRESSIBLE ||
          chunk.retentionStrategy ===
            ChunkRetentionStrategy.BATCH_COMPRESSIBLE ||
          chunk.retentionStrategy === ChunkRetentionStrategy.DISPOSABLE),
    );
  }

  /**
   * Trigger compaction for specific chunks
   * This blocks the event queue during compaction
   *
   * @param threadId - The thread ID
   * @param chunks - Chunks to compact (if not provided, uses all compressible chunks)
   */
  async triggerCompaction(
    threadId: string,
    chunks?: MemoryChunk[],
  ): Promise<DispatchResult> {
    const queue = this.getQueue(threadId);

    // Block the queue
    const unblock = queue.block(BlockingReason.COMPACTING);

    try {
      // Get current state
      const currentState = await this.threadManager.getCurrentState(threadId);
      if (!currentState) {
        throw new Error(`Current state not found for thread: ${threadId}`);
      }

      // Get chunks to compact
      const chunksToCompact =
        chunks ?? this.getCompressibleChunks(currentState);
      if (chunksToCompact.length === 0) {
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

      // Notify observers of compaction start
      const chunkIds = chunksToCompact.map((c) => c.id);
      this.observerManager.notifyCompactionStart({
        threadId,
        chunkCount: chunksToCompact.length,
        chunkIds,
        timestamp: Date.now(),
      });

      // Find a suitable compactor
      const compactor = this.compactors.find((c) =>
        c.canCompact(chunksToCompact),
      );
      if (!compactor) {
        throw new Error('No suitable compactor found for chunks');
      }

      // Build compaction context
      const context: CompactionContext = {
        state: currentState,
        taskGoal: this.extractTaskGoal(currentState),
        progressSummary: this.extractProgressSummary(currentState),
      };

      // Run compaction
      const compactionResult = await compactor.compact(
        chunksToCompact,
        context,
      );

      // Create batch replace operation
      const operation = createBatchReplaceOperation(
        compactionResult.originalChunkIds,
        compactionResult.compactedChunk.id,
      );

      // Apply through thread manager
      const result = await this.threadManager.applyReducerResult(threadId, {
        operations: [operation],
        chunks: [compactionResult.compactedChunk],
      });

      // Notify observers of compaction end
      this.observerManager.notifyCompactionEnd({
        threadId,
        tokensBefore: compactionResult.tokensBefore ?? 0,
        tokensAfter: compactionResult.tokensAfter ?? 0,
        compactedChunkId: compactionResult.compactedChunk.id,
        originalChunkIds: compactionResult.originalChunkIds,
        timestamp: Date.now(),
      });

      return result;
    } finally {
      // Unblock the queue
      unblock();

      // Process any queued events
      await queue.processQueue((event) => this.processEvent(threadId, event));
    }
  }

  /**
   * Extract task goal from state (for compaction context)
   */
  private extractTaskGoal(state: MemoryState): string | undefined {
    // Look for system chunks or delegation chunks with task info
    for (const chunk of state.chunks.values()) {
      if (
        chunk.type === ChunkType.SYSTEM ||
        chunk.type === ChunkType.DELEGATION
      ) {
        const content = chunk.content;
        if ('task' in content && typeof content.task === 'string') {
          return content.task;
        }
        if ('taskContext' in content && content.taskContext) {
          const ctx = content.taskContext as Record<string, unknown>;
          if ('goal' in ctx && typeof ctx.goal === 'string') {
            return ctx.goal;
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Extract progress summary from state (for compaction context)
   */
  private extractProgressSummary(state: MemoryState): string | undefined {
    // Look for existing compacted chunks
    for (const chunk of state.chunks.values()) {
      if (
        chunk.type === ChunkType.WORKING_FLOW &&
        chunk.metadata.custom?.subType === 'COMPACTED'
      ) {
        const content = chunk.content;
        if ('text' in content && typeof content.text === 'string') {
          return content.text;
        }
      }
    }
    return undefined;
  }

  /**
   * Dispatch multiple events sequentially
   * @param threadId - The thread ID
   * @param events - Events to process in order
   * @returns The final result after processing all events
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
   * Delete a thread and all its associated data
   * @param threadId - The thread ID
   */
  async deleteThread(threadId: string): Promise<void> {
    // Clear the queue
    const queue = this.eventQueues.get(threadId);
    if (queue) {
      queue.clear(new Error('Thread deleted'));
      this.eventQueues.delete(threadId);
    }

    return this.threadManager.deleteThread(threadId);
  }

  /**
   * Register a custom compactor
   * @param compactor - The compactor to register
   */
  registerCompactor(compactor: ICompactor): void {
    this.compactors.push(compactor);
  }

  /**
   * Get the underlying thread manager for advanced operations
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

  /**
   * Add an observer to receive memory events
   * @param observer - The observer to add
   * @returns A function to remove the observer
   */
  addObserver(observer: MemoryObserver): () => void {
    return this.observerManager.addObserver(observer);
  }

  /**
   * Remove an observer
   * @param observer - The observer to remove
   */
  removeObserver(observer: MemoryObserver): void {
    this.observerManager.removeObserver(observer);
  }

  /**
   * Get the observer manager for advanced operations
   */
  getObserverManager(): ObserverManager {
    return this.observerManager;
  }

  // ============ Execution Mode Control ============

  /**
   * Get the execution mode for a thread
   * @param threadId - The thread ID
   * @returns The current execution mode
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
   *
   * @param threadId - The thread ID
   * @param mode - The new execution mode
   */
  async setExecutionMode(threadId: string, mode: ExecutionMode): Promise<void> {
    const currentMode = this.getExecutionMode(threadId);
    if (currentMode === mode) {
      return;
    }

    const queue = this.getQueue(threadId);
    this.executionModes.set(threadId, mode);

    if (mode === 'stepping') {
      // Enter stepping mode: block the queue
      if (!queue.isBlocked()) {
        queue.block(BlockingReason.STEPPING);
      }
    } else {
      // Enter auto mode: unblock and process queued events
      if (queue.getBlockingReason() === BlockingReason.STEPPING) {
        // Need to unblock - get a new unblock function by re-blocking then immediately process
        // Actually, we need to handle this differently since block() returns an unblock function
        // For now, we'll create a mechanism to force unblock for STEPPING
        this.forceUnblockStepping(threadId);
        // Process any queued events
        await queue.processQueue((event) => this.processEvent(threadId, event));
      }
    }
  }

  /**
   * Force unblock a queue that's in STEPPING mode
   * This is a workaround since block() returns the unblock function
   */
  private forceUnblockStepping(threadId: string): void {
    const queue = this.getQueue(threadId);
    if (queue.getBlockingReason() === BlockingReason.STEPPING) {
      // Access private unblock - we need to expose this or redesign
      // For now, we'll use a trick: the queue stores the unblock resolve
      (queue as any).blockingReason = null;
      if ((queue as any).unblockResolve) {
        (queue as any).unblockResolve();
        (queue as any).unblockResolve = null;
      }
      (queue as any).blockingPromise = null;
    }
  }

  /**
   * Initialize execution mode for a new thread
   * Called internally when creating threads
   *
   * @param threadId - The thread ID
   * @param mode - The execution mode to set (defaults to config default)
   */
  initializeExecutionMode(threadId: string, mode?: ExecutionMode): void {
    const effectiveMode = mode ?? this.config.defaultExecutionMode ?? 'auto';
    this.executionModes.set(threadId, effectiveMode);

    if (effectiveMode === 'stepping') {
      const queue = this.getQueue(threadId);
      if (!queue.isBlocked()) {
        queue.block(BlockingReason.STEPPING);
      }
    }
  }

  /**
   * Check if there's a pending compaction that should be executed
   * @param threadId - The thread ID
   * @returns true if compaction is pending
   */
  hasPendingCompaction(threadId: string): boolean {
    return this.pendingCompaction.has(threadId);
  }

  /**
   * Get the number of queued events for a thread
   * @param threadId - The thread ID
   */
  getQueuedEventCount(threadId: string): number {
    const queue = this.eventQueues.get(threadId);
    return queue?.getQueueLength() ?? 0;
  }

  /**
   * Peek at the next event in the queue without processing it
   * @param threadId - The thread ID
   * @returns The next event or null if queue is empty
   */
  peekNextEvent(threadId: string): AgentEvent | null {
    const queue = this.eventQueues.get(threadId);
    return queue?.peek() ?? null;
  }

  /**
   * Execute a single step in stepping mode
   * If there's a pending compaction, it will be executed first
   * Otherwise, processes the next queued event
   *
   * @param threadId - The thread ID
   * @returns The result of the step operation
   */
  async step(threadId: string): Promise<StepResult> {
    const mode = this.getExecutionMode(threadId);
    if (mode !== 'stepping') {
      throw new Error(
        `Cannot step in '${mode}' mode. Set execution mode to 'stepping' first.`,
      );
    }

    const queue = this.getQueue(threadId);

    // Check for pending compaction first (compaction takes priority)
    if (this.pendingCompaction.has(threadId)) {
      const chunks = this.pendingCompaction.get(threadId)!;
      this.pendingCompaction.delete(threadId);

      // Temporarily unblock for compaction
      this.forceUnblockStepping(threadId);

      try {
        const result = await this.executeCompactionDirect(threadId, chunks);
        return {
          dispatchResult: result,
          compactionPerformed: true,
          remainingEvents: queue.getQueueLength(),
        };
      } finally {
        // Re-block for stepping mode
        if (!queue.isBlocked()) {
          queue.block(BlockingReason.STEPPING);
        }
      }
    }

    // No pending compaction, process next event
    if (queue.getQueueLength() === 0) {
      return {
        dispatchResult: null,
        compactionPerformed: false,
        remainingEvents: 0,
      };
    }

    // Temporarily unblock to process one event
    this.forceUnblockStepping(threadId);

    try {
      const result = await queue.processOne((event) =>
        this.processEventForStepping(threadId, event),
      );

      return {
        dispatchResult: result,
        compactionPerformed: false,
        remainingEvents: queue.getQueueLength(),
      };
    } finally {
      // Re-block for stepping mode
      if (!queue.isBlocked()) {
        queue.block(BlockingReason.STEPPING);
      }
    }
  }

  /**
   * Process an event in stepping mode (doesn't trigger auto-compaction immediately)
   * Instead, queues compaction for the next step
   */
  private async processEventForStepping(
    threadId: string,
    event: AgentEvent,
  ): Promise<DispatchResult> {
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

    // If no operations, return current state unchanged
    if (reducerResult.operations.length === 0) {
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

    // Apply reducer result through thread manager
    const result = await this.threadManager.applyReducerResult(
      threadId,
      reducerResult,
    );

    // Notify observers of state change
    this.observerManager.notifyStateChange({
      threadId,
      previousState: currentState,
      newState: result.state,
      triggerEvent: event,
      reducerName: 'ReducerRegistry',
      operations: reducerResult.operations,
      addedChunks: result.addedChunks,
      removedChunkIds: result.removedChunkIds,
    });

    // In stepping mode, check for compaction but don't execute - queue it for next step
    if (this.config.autoCompactEnabled) {
      const compressibleChunks = this.getCompressibleChunks(result.state);
      const threshold = this.config.autoCompactThreshold ?? 20;

      if (compressibleChunks.length >= threshold) {
        // Queue compaction for next step instead of executing immediately
        this.pendingCompaction.set(threadId, compressibleChunks);
      }
    }

    return result;
  }

  /**
   * Execute compaction directly (without queue blocking, for stepping mode)
   */
  private async executeCompactionDirect(
    threadId: string,
    chunks: MemoryChunk[],
  ): Promise<DispatchResult> {
    // Get current state
    const currentState = await this.threadManager.getCurrentState(threadId);
    if (!currentState) {
      throw new Error(`Current state not found for thread: ${threadId}`);
    }

    if (chunks.length === 0) {
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

    // Notify observers of compaction start
    const chunkIds = chunks.map((c) => c.id);
    this.observerManager.notifyCompactionStart({
      threadId,
      chunkCount: chunks.length,
      chunkIds,
      timestamp: Date.now(),
    });

    // Find a suitable compactor
    const compactor = this.compactors.find((c) => c.canCompact(chunks));
    if (!compactor) {
      throw new Error('No suitable compactor found for chunks');
    }

    // Build compaction context
    const context: CompactionContext = {
      state: currentState,
      taskGoal: this.extractTaskGoal(currentState),
      progressSummary: this.extractProgressSummary(currentState),
    };

    // Run compaction
    const compactionResult = await compactor.compact(chunks, context);

    // Create batch replace operation
    const operation = createBatchReplaceOperation(
      compactionResult.originalChunkIds,
      compactionResult.compactedChunk.id,
    );

    // Apply through thread manager
    const result = await this.threadManager.applyReducerResult(threadId, {
      operations: [operation],
      chunks: [compactionResult.compactedChunk],
    });

    // Notify observers of compaction end
    this.observerManager.notifyCompactionEnd({
      threadId,
      tokensBefore: compactionResult.tokensBefore ?? 0,
      tokensAfter: compactionResult.tokensAfter ?? 0,
      compactedChunkId: compactionResult.compactedChunk.id,
      originalChunkIds: compactionResult.originalChunkIds,
      timestamp: Date.now(),
    });

    return result;
  }
}
