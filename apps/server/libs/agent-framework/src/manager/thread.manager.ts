import { MemoryThread } from '../types/thread.types.js';
import { MemoryState } from '../types/state.types.js';
import { MemoryChunk } from '../types/chunk.types.js';
import { Operation } from '../types/operation.types.js';
import { ReducerResult } from '../reducer/reducer.types.js';
import { StorageProvider } from '../storage/storage.types.js';
import { createThread, updateThread } from '../factories/thread.factory.js';
import { createState } from '../factories/state.factory.js';
import {
  applyOperations,
  createExecutionContext,
  ApplyResult,
} from '../executor/operation.executor.js';

/**
 * Options for creating a new thread
 */
export interface CreateThreadOptions {
  /** Initial chunks to include in the thread */
  initialChunks?: MemoryChunk[];
  /** Custom metadata for the thread */
  custom?: Record<string, unknown>;
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
   * @param threadId - The thread ID
   * @returns The current state or null if not found
   */
  async getCurrentState(
    threadId: string,
  ): Promise<Readonly<MemoryState> | null> {
    return this.storage.getLatestState(threadId);
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
}
