import type { MemoryThread } from '../types/thread.types.js';
import type { MemoryState, StateProvenance } from '../types/state.types.js';
import type { MemoryChunk } from '../types/chunk.types.js';
import type { ReducerResult } from '../reducer/reducer.types.js';
import type { LLMResponseRequirement } from '../types/event.types.js';
import type { IMemoryManager } from './memory-manager.interface.js';
import { updateThread } from '../factories/thread.factory.js';
import {
  applyOperations,
  applyOperationsWithProvenance,
  createExecutionContext,
} from '../executor/operation.executor.js';

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
 * Interface for state transition operations
 */
export interface IStateTransitionManager {
  applyReducerResult(
    threadId: string,
    reducerResult: ReducerResult,
  ): Promise<ApplyReducerResultOutput>;

  applyReducerResultWithProvenance(
    threadId: string,
    reducerResult: ReducerResult,
    provenance: StateProvenance,
    llmResponseRequirement: LLMResponseRequirement,
  ): Promise<ApplyReducerResultOutput>;
}

/**
 * StateTransitionManager handles state transitions for threads
 * Applies reducer results and updates thread state
 */
export class StateTransitionManager {
  constructor(private memoryManager: IMemoryManager) {}

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
    const thread = await this.memoryManager.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    const currentState = await this.memoryManager.getCurrentState(threadId);
    if (!currentState) {
      throw new Error(`Current state not found for thread: ${threadId}`);
    }

    const storage = this.memoryManager.getStorage();

    // Create execution context with pending chunks
    const context = createExecutionContext(storage, reducerResult.chunks);

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
    await storage.updateThread(updatedThread);

    // Update cache with new state so subsequent calls see the latest state
    this.memoryManager.updateStateCache(threadId, result.state);

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
   * @param llmResponseRequirement - Event's requirement for LLM response
   * @returns The updated thread and new state
   */
  async applyReducerResultWithProvenance(
    threadId: string,
    reducerResult: ReducerResult,
    provenance: StateProvenance,
    llmResponseRequirement: LLMResponseRequirement,
  ): Promise<ApplyReducerResultOutput> {
    const thread = await this.memoryManager.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    const currentState = await this.memoryManager.getCurrentState(threadId);
    if (!currentState) {
      throw new Error(`Current state not found for thread: ${threadId}`);
    }

    const storage = this.memoryManager.getStorage();

    // Create execution context with pending chunks
    const context = createExecutionContext(storage, reducerResult.chunks);

    // Apply all operations with provenance
    const result = await applyOperationsWithProvenance(
      currentState,
      reducerResult.operations,
      context,
      provenance,
      llmResponseRequirement,
    );

    // Update thread with new current state
    const updatedThread = updateThread(thread, {
      currentStateId: result.state.id,
    });

    // Persist updated thread
    await storage.updateThread(updatedThread);

    // Update cache with new state so subsequent calls see the latest state
    this.memoryManager.updateStateCache(threadId, result.state);

    return {
      thread: updatedThread,
      state: result.state,
      addedChunks: result.addedChunks,
      removedChunkIds: result.removedChunkIds,
    };
  }
}
