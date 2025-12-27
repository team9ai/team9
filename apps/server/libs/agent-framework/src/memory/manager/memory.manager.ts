import { MemoryThread } from '../types/thread.types';
import { MemoryState } from '../types/state.types';
import {
  MemoryChunk,
  ChunkType,
  ChunkRetentionStrategy,
} from '../types/chunk.types';
import { AgentEvent } from '../types/event.types';
import { ReducerRegistry } from '../reducer/reducer.types';
import { StorageProvider } from '../storage/storage.types';
import { ILLMAdapter, LLMConfig } from '../llm/llm.types';
import { ICompactor, CompactionContext } from '../compactor/compactor.types';
import { WorkingFlowCompactor } from '../compactor/working-flow.compactor';
import {
  ThreadManager,
  CreateThreadOptions,
  CreateThreadResult,
} from './thread.manager';
import { EventQueue, BlockingReason } from './event-queue';
import { createBatchReplaceOperation } from '../factories/operation.factory';
import type {
  MemoryObserver,
  ObserverManager,
} from '../observer/observer.types';
import { DefaultObserverManager } from '../observer/observer-manager';

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
   * If blocked, the event is queued and processed later
   *
   * @param threadId - The thread ID
   * @param event - The event to process
   * @returns The result of processing the event
   */
  async dispatch(threadId: string, event: AgentEvent): Promise<DispatchResult> {
    const queue = this.getQueue(threadId);

    // If blocked, enqueue and wait
    if (queue.isBlocked()) {
      return queue.enqueue(event);
    }

    // Process immediately
    return this.processEvent(threadId, event);
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
}
