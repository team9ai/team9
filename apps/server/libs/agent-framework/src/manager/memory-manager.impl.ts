/**
 * MemoryManager Implementation
 *
 * Pure data layer for managing Thread, State, Step, and Event Queue.
 * No business logic - just persistence and retrieval operations.
 *
 * @module manager/memory-manager.impl
 */

import type { MemoryState } from '../types/state.types.js';
import type { MemoryThread, QueuedEvent } from '../types/thread.types.js';
import type { StorageProvider } from '../storage/storage.types.js';
import type {
  IMemoryManager,
  IEventQueue,
  Step,
  CreateThreadOptions,
  CreateThreadResult,
} from './memory-manager.interface.js';

import { createThread, updateThread } from '../factories/thread.factory.js';
import { createState } from '../factories/state.factory.js';
import { generateStepId } from '../utils/id.utils.js';

/**
 * Event Queue implementation that wraps StorageProvider operations
 */
class EventQueue implements IEventQueue {
  constructor(
    private storage: StorageProvider,
    private threadId: string,
  ) {}

  async push(event: QueuedEvent): Promise<void> {
    await this.storage.pushEvent(this.threadId, event);
  }

  async pushMany(events: QueuedEvent[]): Promise<void> {
    await this.storage.pushEvents(this.threadId, events);
  }

  async pop(): Promise<QueuedEvent | null> {
    return this.storage.popEvent(this.threadId);
  }

  async peek(): Promise<QueuedEvent | null> {
    return this.storage.peekEvent(this.threadId);
  }

  async getAll(): Promise<QueuedEvent[]> {
    return this.storage.getEventQueue(this.threadId);
  }

  async clear(): Promise<void> {
    await this.storage.clearEventQueue(this.threadId);
  }

  async length(): Promise<number> {
    return this.storage.getEventQueueLength(this.threadId);
  }
}

/**
 * MemoryManager - Pure Data Layer Implementation
 *
 * Responsibilities:
 * - Thread lifecycle management (create, get, delete)
 * - State retrieval (with caching)
 * - Step recording
 * - Event queue access
 *
 * Does NOT handle:
 * - Operation execution (handled by AgentOrchestrator)
 * - Event dispatching logic
 * - Reducer execution
 * - Execution mode control
 * - Step locking (runtime coordination)
 */
export class MemoryManagerImpl implements IMemoryManager {
  /**
   * In-memory cache for current state per thread
   * This ensures that consecutive operations see the latest state
   * even before the database query returns the updated state
   */
  private currentStateCache: Map<string, Readonly<MemoryState>> = new Map();

  constructor(private storage: StorageProvider) {}

  // ============ Thread Operations ============

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
      provenance: {
        source: 'initial',
        timestamp: Date.now(),
      },
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

  async getThread(threadId: string): Promise<Readonly<MemoryThread> | null> {
    return this.storage.getThread(threadId);
  }

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

      // Delete steps
      const steps = await tx.getStepsByThread(threadId);
      for (const step of steps) {
        await tx.deleteStep(step.id);
      }

      // Clear event queue
      await tx.clearEventQueue(threadId);

      // Delete thread
      await tx.deleteThread(threadId);
    });
  }

  // ============ State Operations ============

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

  async getState(stateId: string): Promise<Readonly<MemoryState> | null> {
    return this.storage.getState(stateId);
  }

  async getInitialState(
    threadId: string,
  ): Promise<Readonly<MemoryState> | null> {
    return this.storage.getInitialState(threadId);
  }

  async getStateHistory(threadId: string): Promise<Readonly<MemoryState>[]> {
    return this.storage.getStatesByThread(threadId);
  }

  // ============ Step Operations ============

  async recordStep(step: Omit<Step, 'id'>): Promise<string> {
    const stepId = generateStepId();
    const fullStep: Step = {
      ...step,
      id: stepId,
    };
    await this.storage.saveStep(fullStep);
    return stepId;
  }

  async getStep(stepId: string): Promise<Step | null> {
    return this.storage.getStep(stepId);
  }

  async getStepsByThread(threadId: string): Promise<Step[]> {
    return this.storage.getStepsByThread(threadId);
  }

  async updateStep(
    stepId: string,
    updates: Partial<Omit<Step, 'id'>>,
  ): Promise<void> {
    const step = await this.storage.getStep(stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    const updatedStep: Step = {
      ...step,
      ...updates,
    };

    await this.storage.updateStep(updatedStep);
  }

  // ============ Event Queue Operations ============

  getEventQueue(threadId: string): IEventQueue {
    return new EventQueue(this.storage, threadId);
  }

  // ============ Parent-Child Thread Operations ============

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

  async getParentThread(
    childThreadId: string,
  ): Promise<Readonly<MemoryThread> | null> {
    const thread = await this.storage.getThread(childThreadId);
    if (!thread || !thread.parentThreadId) {
      return null;
    }

    return this.storage.getThread(thread.parentThreadId);
  }

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

  // ============ Storage Access ============

  getStorage(): StorageProvider {
    return this.storage;
  }

  // ============ Cache Management ============

  /**
   * Update the state cache for a thread
   * Called by AgentOrchestrator after applying operations
   * @param threadId - The thread ID
   * @param state - The new state to cache
   */
  updateStateCache(threadId: string, state: Readonly<MemoryState>): void {
    this.currentStateCache.set(threadId, state);
  }

  /**
   * Clear the state cache for a thread
   * Useful when the state needs to be re-read from storage
   * @param threadId - The thread ID
   */
  clearStateCache(threadId: string): void {
    this.currentStateCache.delete(threadId);
  }
}
