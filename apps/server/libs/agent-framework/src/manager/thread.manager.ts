import {
  MemoryThread,
  QueuedEvent,
  Step,
  LLMInteraction,
} from '../types/thread.types.js';
import { MemoryState, StateProvenance } from '../types/state.types.js';
import { MemoryChunk } from '../types/chunk.types.js';
import { AgentEvent } from '../types/event.types.js';
import { Operation } from '../types/operation.types.js';
import { ReducerResult } from '../reducer/reducer.types.js';
import { StorageProvider } from '../storage/storage.types.js';
import { createThread, updateThread } from '../factories/thread.factory.js';
import { createState } from '../factories/state.factory.js';
import {
  applyOperations,
  applyOperationsWithProvenance,
  createExecutionContext,
  ApplyResult,
} from '../executor/operation.executor.js';
import { generateQueuedEventId, generateStepId } from '../utils/id.utils.js';

/**
 * Options for creating a new thread
 */
export interface CreateThreadOptions {
  /** Initial chunks to include in the thread */
  initialChunks?: MemoryChunk[];
  /** Custom user-defined metadata for the thread */
  custom?: Record<string, unknown>;
  /** Parent thread ID for subagent threads */
  parentThreadId?: string;

  // ============ Blueprint Configuration ============

  /** Blueprint ID that created this thread */
  blueprintId?: string;
  /** Blueprint name for identification */
  blueprintName?: string;
  /** Blueprint key for subagent threads */
  blueprintKey?: string;
  /** LLM configuration for this thread */
  llmConfig?: import('../llm/llm.types.js').LLMConfig;
  /** Available control tools */
  tools?: string[];
  /** SubAgent blueprints for spawning */
  subAgents?: Record<
    string,
    import('../blueprint/blueprint.types.js').Blueprint
  >;
}

/**
 * Result of creating a thread
 */
export interface CreateThreadResult {
  /** The created thread */
  thread: Readonly<MemoryThread>;
  /** The initial state of the thread */
  initialState: Readonly<MemoryState>;
}

/**
 * Result of applying a reducer result
 */
export interface ApplyReducerResultOutput {
  /** The updated thread */
  thread: Readonly<MemoryThread>;
  /** The new state after applying operations */
  state: Readonly<MemoryState>;
  /** Chunks that were added */
  addedChunks: MemoryChunk[];
  /** Chunk IDs that were removed */
  removedChunkIds: string[];
}

/**
 * ThreadManager handles thread lifecycle and state transitions
 * It coordinates between threads, states, and storage
 */
export class ThreadManager {
  /**
   * In-memory cache for current state per thread
   * This ensures that consecutive dispatches see the latest state
   * even before the database query returns the updated state
   */
  private currentStateCache: Map<string, Readonly<MemoryState>> = new Map();

  constructor(private storage: StorageProvider) {}

  /**
   * Create a new thread with an initial state
   * @param options - Options for thread creation
   * @returns The created thread and its initial state
   */
  async createThread(
    options?: CreateThreadOptions,
  ): Promise<CreateThreadResult> {
    // Create the thread
    const thread = createThread({
      custom: options?.custom,
      parentThreadId: options?.parentThreadId,
      blueprintId: options?.blueprintId,
      blueprintName: options?.blueprintName,
      blueprintKey: options?.blueprintKey,
      llmConfig: options?.llmConfig,
      tools: options?.tools,
      subAgents: options?.subAgents,
    });

    // Create initial state with optional chunks
    const initialChunks = options?.initialChunks ?? [];
    const initialState = createState({
      threadId: thread.id,
      chunks: initialChunks,
    });

    // Update thread with state references
    const updatedThread = updateThread(thread, {
      initialStateId: initialState.id,
      currentStateId: initialState.id,
    });

    // Persist to storage in a transaction
    await this.storage.transaction(async (tx) => {
      await tx.saveThread(updatedThread);
      if (initialChunks.length > 0) {
        await tx.saveChunks(initialChunks);
      }
      await tx.saveState(initialState);
    });

    // Initialize cache with initial state
    this.currentStateCache.set(updatedThread.id, initialState);

    return {
      thread: updatedThread,
      initialState,
    };
  }

  /**
   * Get a thread by ID
   * @param threadId - The thread ID
   * @returns The thread or null if not found
   */
  async getThread(threadId: string): Promise<Readonly<MemoryThread> | null> {
    return this.storage.getThread(threadId);
  }

  /**
   * Get the current state of a thread
   * First checks the in-memory cache, then falls back to storage
   * @param threadId - The thread ID
   * @returns The current state or null if not found
   */
  async getCurrentState(
    threadId: string,
  ): Promise<Readonly<MemoryState> | null> {
    // Check cache first for the most up-to-date state
    const cachedState = this.currentStateCache.get(threadId);
    if (cachedState) {
      return cachedState;
    }
    // Fall back to storage and populate cache
    const state = await this.storage.getLatestState(threadId);
    if (state) {
      this.currentStateCache.set(threadId, state);
    }
    return state;
  }

  /**
   * Get the initial state of a thread
   * @param threadId - The thread ID
   * @returns The initial state or null if not found
   */
  async getInitialState(
    threadId: string,
  ): Promise<Readonly<MemoryState> | null> {
    return this.storage.getInitialState(threadId);
  }

  /**
   * Get all states for a thread (history)
   * @param threadId - The thread ID
   * @returns Array of states ordered by creation time
   */
  async getStateHistory(threadId: string): Promise<Readonly<MemoryState>[]> {
    return this.storage.getStatesByThread(threadId);
  }

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
    const thread = await this.storage.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    const currentState = await this.getCurrentState(threadId);
    if (!currentState) {
      throw new Error(`Current state not found for thread: ${threadId}`);
    }

    // Create execution context with pending chunks
    const context = createExecutionContext(this.storage, reducerResult.chunks);

    // Apply all operations
    const result = await applyOperations(
      currentState,
      reducerResult.operations,
      context,
    );

    // Update thread with new current state
    const updatedThread = updateThread(thread, {
      currentStateId: result.state.id,
    });

    // Persist updated thread
    await this.storage.updateThread(updatedThread);

    // Update cache with new state so subsequent calls see the latest state
    this.currentStateCache.set(threadId, result.state);

    return {
      thread: updatedThread,
      state: result.state,
      addedChunks: result.addedChunks,
      removedChunkIds: result.removedChunkIds,
    };
  }

  /**
   * Apply a reducer result to a thread with provenance tracking
   * Records the event, step, and operation that caused the state transition
   * @param threadId - The thread ID
   * @param reducerResult - The result from a reducer
   * @param provenance - Provenance information for traceability
   * @returns The updated thread and new state
   */
  async applyReducerResultWithProvenance(
    threadId: string,
    reducerResult: ReducerResult,
    provenance: StateProvenance,
  ): Promise<ApplyReducerResultOutput> {
    const thread = await this.storage.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    const currentState = await this.getCurrentState(threadId);
    if (!currentState) {
      throw new Error(`Current state not found for thread: ${threadId}`);
    }

    // Create execution context with pending chunks
    const context = createExecutionContext(this.storage, reducerResult.chunks);

    // Apply all operations with provenance
    const result = await applyOperationsWithProvenance(
      currentState,
      reducerResult.operations,
      context,
      provenance,
    );

    // Update thread with new current state
    const updatedThread = updateThread(thread, {
      currentStateId: result.state.id,
    });

    // Persist updated thread
    await this.storage.updateThread(updatedThread);

    // Update cache with new state so subsequent calls see the latest state
    this.currentStateCache.set(threadId, result.state);

    return {
      thread: updatedThread,
      state: result.state,
      addedChunks: result.addedChunks,
      removedChunkIds: result.removedChunkIds,
    };
  }

  /**
   * Apply operations directly to a thread
   * @param threadId - The thread ID
   * @param operations - Operations to apply
   * @param chunks - New chunks referenced by operations
   * @returns The updated thread and new state
   */
  async applyOperations(
    threadId: string,
    operations: Operation[],
    chunks: MemoryChunk[] = [],
  ): Promise<ApplyReducerResultOutput> {
    return this.applyReducerResult(threadId, { operations, chunks });
  }

  /**
   * Delete a thread and all its associated data
   * @param threadId - The thread ID
   */
  async deleteThread(threadId: string): Promise<void> {
    // Clear cache first
    this.currentStateCache.delete(threadId);

    await this.storage.transaction(async (tx) => {
      // Get all states for the thread
      const states = await tx.getStatesByThread(threadId);

      // Collect all chunk IDs
      const chunkIds = new Set<string>();
      for (const state of states) {
        for (const chunkId of state.chunkIds) {
          chunkIds.add(chunkId);
        }
      }

      // Delete states
      for (const state of states) {
        await tx.deleteState(state.id);
      }

      // Delete chunks
      for (const chunkId of chunkIds) {
        await tx.deleteChunk(chunkId);
      }

      // Delete thread
      await tx.deleteThread(threadId);
    });
  }

  /**
   * Clear the state cache for a thread
   * Useful when the state needs to be re-read from storage
   * @param threadId - The thread ID
   */
  clearStateCache(threadId: string): void {
    this.currentStateCache.delete(threadId);
  }

  // ============ Event Queue Operations ============

  /**
   * Get the event queue for a thread
   * @param threadId - The thread ID
   * @returns The event queue or empty array if not found
   */
  async getEventQueue(threadId: string): Promise<QueuedEvent[]> {
    const thread = await this.storage.getThread(threadId);
    return thread?.eventQueue ?? [];
  }

  /**
   * Push an event to the thread's event queue
   * @param threadId - The thread ID
   * @param event - The event to push
   * @returns The queued event with generated ID
   */
  async pushEvent(threadId: string, event: AgentEvent): Promise<QueuedEvent> {
    const thread = await this.storage.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    const queuedEvent: QueuedEvent = {
      id: generateQueuedEventId(),
      event,
      queuedAt: Date.now(),
    };

    const currentQueue = thread.eventQueue ?? [];
    const updatedThread = updateThread(thread, {
      eventQueue: [...currentQueue, queuedEvent],
    });

    await this.storage.updateThread(updatedThread);
    return queuedEvent;
  }

  /**
   * Pop the first event from the thread's event queue
   * @param threadId - The thread ID
   * @returns The popped event or null if queue is empty
   */
  async popEvent(threadId: string): Promise<QueuedEvent | null> {
    const thread = await this.storage.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    const currentQueue = thread.eventQueue ?? [];
    if (currentQueue.length === 0) {
      return null;
    }

    const [poppedEvent, ...remainingQueue] = currentQueue;
    const updatedThread = updateThread(thread, {
      eventQueue: remainingQueue,
    });

    await this.storage.updateThread(updatedThread);
    return poppedEvent;
  }

  /**
   * Peek at the first event in the queue without removing it
   * @param threadId - The thread ID
   * @returns The first event or null if queue is empty
   */
  async peekEvent(threadId: string): Promise<QueuedEvent | null> {
    const thread = await this.storage.getThread(threadId);
    if (!thread) {
      return null;
    }

    const currentQueue = thread.eventQueue ?? [];
    return currentQueue[0] ?? null;
  }

  /**
   * Get the number of events in the queue
   * @param threadId - The thread ID
   * @returns The queue length
   */
  async getEventQueueLength(threadId: string): Promise<number> {
    const thread = await this.storage.getThread(threadId);
    return thread?.eventQueue?.length ?? 0;
  }

  /**
   * Clear all events from the queue
   * @param threadId - The thread ID
   */
  async clearEventQueue(threadId: string): Promise<void> {
    const thread = await this.storage.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    const updatedThread = updateThread(thread, {
      eventQueue: [],
    });

    await this.storage.updateThread(updatedThread);
  }

  // ============ Step Lock Operations ============

  /**
   * Acquire a step lock for processing
   * If the thread is already locked, throws an error
   * @param threadId - The thread ID
   * @returns The generated step ID
   */
  async acquireStepLock(threadId: string): Promise<string> {
    const thread = await this.storage.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    if (thread.currentStepId) {
      throw new Error(
        `Thread ${threadId} is already processing step ${thread.currentStepId}`,
      );
    }

    const stepId = generateStepId();
    const updatedThread = updateThread(thread, {
      currentStepId: stepId,
    });

    await this.storage.updateThread(updatedThread);
    return stepId;
  }

  /**
   * Release the step lock after processing completes
   * @param threadId - The thread ID
   * @param stepId - The step ID to release (must match current lock)
   */
  async releaseStepLock(threadId: string, stepId: string): Promise<void> {
    const thread = await this.storage.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    if (thread.currentStepId !== stepId) {
      throw new Error(
        `Step lock mismatch: expected ${thread.currentStepId}, got ${stepId}`,
      );
    }

    const updatedThread = updateThread(thread, {
      currentStepId: undefined,
    });

    await this.storage.updateThread(updatedThread);
  }

  /**
   * Check if the thread is currently locked for processing
   * @param threadId - The thread ID
   * @returns True if locked, false otherwise
   */
  async isStepLocked(threadId: string): Promise<boolean> {
    const thread = await this.storage.getThread(threadId);
    return thread?.currentStepId !== undefined;
  }

  /**
   * Get the current step ID if locked
   * @param threadId - The thread ID
   * @returns The current step ID or null if not locked
   */
  async getCurrentStepId(threadId: string): Promise<string | null> {
    const thread = await this.storage.getThread(threadId);
    return thread?.currentStepId ?? null;
  }

  // ============ Needs Response Flag Operations ============

  /**
   * Check if the thread needs a response from the LLM
   * @param threadId - The thread ID
   * @returns True if response is needed, false otherwise
   */
  async needsResponse(threadId: string): Promise<boolean> {
    const thread = await this.storage.getThread(threadId);
    return thread?.needsResponse ?? false;
  }

  /**
   * Set the needsResponse flag for a thread
   * @param threadId - The thread ID
   * @param value - Whether response is needed
   */
  async setNeedsResponse(threadId: string, value: boolean): Promise<void> {
    const thread = await this.storage.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    const updatedThread = updateThread(thread, {
      needsResponse: value,
    });

    await this.storage.updateThread(updatedThread);
  }

  // ============ Step Lifecycle Operations ============

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
    const step: Step = {
      id: stepId,
      threadId,
      triggerEvent,
      eventPayload,
      status: 'running',
      startedAt: Date.now(),
      previousStateId,
    };

    await this.storage.saveStep(step);
    return step;
  }

  /**
   * Complete a step successfully
   * @param stepId - The step ID
   * @param resultStateId - The resulting state ID
   */
  async completeStep(stepId: string, resultStateId: string): Promise<void> {
    const step = await this.storage.getStep(stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    const completedAt = Date.now();
    const updatedStep: Step = {
      ...step,
      status: 'completed',
      completedAt,
      duration: completedAt - step.startedAt,
      resultStateId,
    };

    await this.storage.updateStep(updatedStep);
  }

  /**
   * Mark a step as failed
   * @param stepId - The step ID
   * @param error - The error message
   */
  async failStep(stepId: string, error: string): Promise<void> {
    const step = await this.storage.getStep(stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    const completedAt = Date.now();
    const updatedStep: Step = {
      ...step,
      status: 'failed',
      completedAt,
      duration: completedAt - step.startedAt,
      error,
    };

    await this.storage.updateStep(updatedStep);
  }

  /**
   * Get a step by ID
   * @param stepId - The step ID
   * @returns The step or null if not found
   */
  async getStep(stepId: string): Promise<Step | null> {
    return this.storage.getStep(stepId);
  }

  /**
   * Get all steps for a thread
   * @param threadId - The thread ID
   * @returns Array of steps ordered by start time
   */
  async getStepsByThread(threadId: string): Promise<Step[]> {
    return this.storage.getStepsByThread(threadId);
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
    const step = await this.storage.getStep(stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    const updatedStep: Step = {
      ...step,
      llmInteraction,
    };

    await this.storage.updateStep(updatedStep);
  }

  // ============ Parent-Child Thread Operations ============

  /**
   * Add a child thread ID to a parent thread
   * @param parentThreadId - The parent thread ID
   * @param childThreadId - The child thread ID to add
   */
  async addChildThread(
    parentThreadId: string,
    childThreadId: string,
  ): Promise<void> {
    const thread = await this.storage.getThread(parentThreadId);
    if (!thread) {
      throw new Error(`Parent thread not found: ${parentThreadId}`);
    }

    const currentChildren = thread.childThreadIds ?? [];
    if (currentChildren.includes(childThreadId)) {
      return; // Already added
    }

    const updatedThread = updateThread(thread, {
      childThreadIds: [...currentChildren, childThreadId],
    });

    await this.storage.updateThread(updatedThread);
  }

  /**
   * Get all child threads for a parent thread
   * @param parentThreadId - The parent thread ID
   * @returns Array of child threads
   */
  async getChildThreads(
    parentThreadId: string,
  ): Promise<Readonly<MemoryThread>[]> {
    const thread = await this.storage.getThread(parentThreadId);
    if (!thread) {
      return [];
    }

    const childIds = thread.childThreadIds ?? [];
    const children: Readonly<MemoryThread>[] = [];

    for (const childId of childIds) {
      const child = await this.storage.getThread(childId);
      if (child) {
        children.push(child);
      }
    }

    return children;
  }

  /**
   * Get the parent thread for a child thread
   * @param childThreadId - The child thread ID
   * @returns The parent thread or null if not found or no parent
   */
  async getParentThread(
    childThreadId: string,
  ): Promise<Readonly<MemoryThread> | null> {
    const thread = await this.storage.getThread(childThreadId);
    if (!thread || !thread.parentThreadId) {
      return null;
    }

    return this.storage.getThread(thread.parentThreadId);
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
    const thread = await this.storage.getThread(parentThreadId);
    if (!thread) {
      return;
    }

    const currentChildren = thread.childThreadIds ?? [];
    const updatedChildren = currentChildren.filter(
      (id) => id !== childThreadId,
    );

    if (updatedChildren.length === currentChildren.length) {
      return; // Child not found
    }

    const updatedThread = updateThread(thread, {
      childThreadIds: updatedChildren,
    });

    await this.storage.updateThread(updatedThread);
  }
}
