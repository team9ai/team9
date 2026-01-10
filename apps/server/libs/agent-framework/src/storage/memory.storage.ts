import { MemoryChunk } from '../types/chunk.types.js';
import { MemoryState } from '../types/state.types.js';
import { MemoryThread, QueuedEvent } from '../types/thread.types.js';
import { Step } from '../manager/memory-manager.interface.js';
import { StorageProvider, ListStatesOptions } from './storage.types.js';

/**
 * Deep clone a MemoryChunk to ensure immutability
 */
function cloneChunk(chunk: MemoryChunk): MemoryChunk {
  return {
    ...chunk,
    content: { ...chunk.content },
    childIds: chunk.childIds ? [...chunk.childIds] : undefined,
    metadata: {
      ...chunk.metadata,
      custom: chunk.metadata.custom ? { ...chunk.metadata.custom } : undefined,
    },
  };
}

/**
 * Deep clone a MemoryState to ensure immutability
 * This prevents mutations from affecting stored states
 */
function cloneState(state: MemoryState): MemoryState {
  // Clone the chunks Map with deep-copied chunks
  const clonedChunks = new Map<string, MemoryChunk>();
  for (const [id, chunk] of state.chunks) {
    clonedChunks.set(id, cloneChunk(chunk));
  }

  return {
    id: state.id,
    threadId: state.threadId,
    chunkIds: [...state.chunkIds],
    chunks: clonedChunks,
    metadata: {
      ...state.metadata,
      custom: state.metadata.custom ? { ...state.metadata.custom } : undefined,
    },
    needLLMContinueResponse: state.needLLMContinueResponse,
  };
}

/**
 * In-memory implementation of StorageProvider
 * Useful for testing and development
 */
export class InMemoryStorageProvider implements StorageProvider {
  private threads = new Map<string, MemoryThread>();
  private chunks = new Map<string, MemoryChunk>();
  private states = new Map<string, MemoryState>();
  private steps = new Map<string, Step>();
  private eventQueues = new Map<string, QueuedEvent[]>();

  // Track chunk-to-thread relationships (derived from states)
  private chunkThreadIndex = new Map<string, string>();
  // Track state-to-thread relationships
  private stateThreadIndex = new Map<string, string[]>();
  // Track step-to-thread relationships
  private stepThreadIndex = new Map<string, string[]>();

  // ============ Thread Operations ============

  async saveThread(thread: MemoryThread): Promise<void> {
    this.threads.set(thread.id, thread);
  }

  async getThread(threadId: string): Promise<MemoryThread | null> {
    return this.threads.get(threadId) ?? null;
  }

  async updateThread(thread: MemoryThread): Promise<void> {
    this.threads.set(thread.id, thread);
  }

  async deleteThread(threadId: string): Promise<void> {
    this.threads.delete(threadId);
  }

  // ============ Chunk Operations ============

  async saveChunk(chunk: MemoryChunk): Promise<void> {
    this.chunks.set(chunk.id, chunk);
  }

  async saveChunks(chunks: MemoryChunk[]): Promise<void> {
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, chunk);
    }
  }

  async getChunk(chunkId: string): Promise<MemoryChunk | null> {
    return this.chunks.get(chunkId) ?? null;
  }

  async getChunks(chunkIds: string[]): Promise<Map<string, MemoryChunk>> {
    const result = new Map<string, MemoryChunk>();
    for (const id of chunkIds) {
      const chunk = this.chunks.get(id);
      if (chunk) {
        result.set(id, chunk);
      }
    }
    return result;
  }

  async getChunksByThread(threadId: string): Promise<MemoryChunk[]> {
    const result: MemoryChunk[] = [];
    for (const [chunkId, tid] of this.chunkThreadIndex) {
      if (tid === threadId) {
        const chunk = this.chunks.get(chunkId);
        if (chunk) {
          result.push(chunk);
        }
      }
    }
    return result;
  }

  async deleteChunk(chunkId: string): Promise<void> {
    this.chunks.delete(chunkId);
    this.chunkThreadIndex.delete(chunkId);
  }

  // ============ State Operations ============

  async saveState(state: MemoryState): Promise<void> {
    // Clone state before saving to ensure immutability
    // This prevents external mutations from affecting stored states
    this.states.set(state.id, cloneState(state));

    // Update thread index
    if (state.threadId) {
      const threadStates = this.stateThreadIndex.get(state.threadId) ?? [];
      if (!threadStates.includes(state.id)) {
        threadStates.push(state.id);
        this.stateThreadIndex.set(state.threadId, threadStates);
      }

      // Update chunk-thread index
      for (const chunkId of state.chunkIds) {
        this.chunkThreadIndex.set(chunkId, state.threadId);
      }
    }
  }

  async getState(stateId: string): Promise<MemoryState | null> {
    const state = this.states.get(stateId);
    // Clone on read to prevent mutations from affecting stored states
    return state ? cloneState(state) : null;
  }

  async getInitialState(threadId: string): Promise<MemoryState | null> {
    const stateIds = this.stateThreadIndex.get(threadId);
    if (!stateIds || stateIds.length === 0) {
      return null;
    }

    // Find the state with the earliest creation time
    let earliestState: MemoryState | null = null;
    let earliestTime = Infinity;

    for (const stateId of stateIds) {
      const state = this.states.get(stateId);
      if (state && state.metadata.createdAt < earliestTime) {
        earliestTime = state.metadata.createdAt;
        earliestState = state;
      }
    }

    // Clone on read to prevent mutations from affecting stored states
    return earliestState ? cloneState(earliestState) : null;
  }

  async getLatestState(threadId: string): Promise<MemoryState | null> {
    const stateIds = this.stateThreadIndex.get(threadId);
    if (!stateIds || stateIds.length === 0) {
      return null;
    }

    // Find the state with the latest creation time
    let latestState: MemoryState | null = null;
    let latestTime = -Infinity;

    for (const stateId of stateIds) {
      const state = this.states.get(stateId);
      if (state && state.metadata.createdAt > latestTime) {
        latestTime = state.metadata.createdAt;
        latestState = state;
      }
    }

    // Clone on read to prevent mutations from affecting stored states
    return latestState ? cloneState(latestState) : null;
  }

  async getStatesByThread(threadId: string): Promise<MemoryState[]> {
    const stateIds = this.stateThreadIndex.get(threadId);
    if (!stateIds) {
      return [];
    }

    const states: MemoryState[] = [];
    for (const stateId of stateIds) {
      const state = this.states.get(stateId);
      if (state) {
        // Clone each state to prevent mutations
        states.push(cloneState(state));
      }
    }

    // Sort by creation time
    return states.sort((a, b) => a.metadata.createdAt - b.metadata.createdAt);
  }

  async listStates(options?: ListStatesOptions): Promise<MemoryState[]> {
    let states = Array.from(this.states.values());

    // Apply filters
    if (options?.threadId) {
      states = states.filter((s) => s.threadId === options.threadId);
    }
    if (options?.fromTimestamp !== undefined) {
      states = states.filter(
        (s) => s.metadata.createdAt >= options.fromTimestamp!,
      );
    }
    if (options?.toTimestamp !== undefined) {
      states = states.filter(
        (s) => s.metadata.createdAt <= options.toTimestamp!,
      );
    }

    // Sort by creation time
    states.sort((a, b) => a.metadata.createdAt - b.metadata.createdAt);

    // Apply pagination
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? states.length;

    // Clone each state to prevent mutations
    return states.slice(offset, offset + limit).map(cloneState);
  }

  async deleteState(stateId: string): Promise<void> {
    const state = this.states.get(stateId);
    if (state?.threadId) {
      const threadStates = this.stateThreadIndex.get(state.threadId);
      if (threadStates) {
        const index = threadStates.indexOf(stateId);
        if (index !== -1) {
          threadStates.splice(index, 1);
        }
      }
    }
    this.states.delete(stateId);
  }

  // ============ Step Operations ============

  async saveStep(step: Step): Promise<void> {
    this.steps.set(step.id, { ...step });

    // Update thread index
    const threadSteps = this.stepThreadIndex.get(step.threadId) ?? [];
    if (!threadSteps.includes(step.id)) {
      threadSteps.push(step.id);
      this.stepThreadIndex.set(step.threadId, threadSteps);
    }
  }

  async getStep(stepId: string): Promise<Step | null> {
    const step = this.steps.get(stepId);
    return step ? { ...step } : null;
  }

  async updateStep(step: Step): Promise<void> {
    this.steps.set(step.id, { ...step });
  }

  async getStepsByThread(threadId: string): Promise<Step[]> {
    const stepIds = this.stepThreadIndex.get(threadId);
    if (!stepIds) {
      return [];
    }

    const steps: Step[] = [];
    for (const stepId of stepIds) {
      const step = this.steps.get(stepId);
      if (step) {
        steps.push({ ...step });
      }
    }

    // Sort by start time
    return steps.sort((a, b) => a.startedAt - b.startedAt);
  }

  async deleteStep(stepId: string): Promise<void> {
    const step = this.steps.get(stepId);
    if (step) {
      const threadSteps = this.stepThreadIndex.get(step.threadId);
      if (threadSteps) {
        const index = threadSteps.indexOf(stepId);
        if (index !== -1) {
          threadSteps.splice(index, 1);
        }
      }
    }
    this.steps.delete(stepId);
  }

  // ============ Event Queue Operations ============

  async pushEvent(threadId: string, event: QueuedEvent): Promise<void> {
    const queue = this.eventQueues.get(threadId) ?? [];
    queue.push({ ...event });
    this.eventQueues.set(threadId, queue);
  }

  async pushEvents(threadId: string, events: QueuedEvent[]): Promise<void> {
    const queue = this.eventQueues.get(threadId) ?? [];
    for (const event of events) {
      queue.push({ ...event });
    }
    this.eventQueues.set(threadId, queue);
  }

  async popEvent(threadId: string): Promise<QueuedEvent | null> {
    const queue = this.eventQueues.get(threadId);
    if (!queue || queue.length === 0) {
      return null;
    }
    const event = queue.shift()!;
    return { ...event };
  }

  async peekEvent(threadId: string): Promise<QueuedEvent | null> {
    const queue = this.eventQueues.get(threadId);
    if (!queue || queue.length === 0) {
      return null;
    }
    return { ...queue[0] };
  }

  async getEventQueue(threadId: string): Promise<QueuedEvent[]> {
    const queue = this.eventQueues.get(threadId) ?? [];
    return queue.map((e) => ({ ...e }));
  }

  async clearEventQueue(threadId: string): Promise<void> {
    this.eventQueues.delete(threadId);
  }

  async getEventQueueLength(threadId: string): Promise<number> {
    const queue = this.eventQueues.get(threadId);
    return queue?.length ?? 0;
  }

  // ============ Transaction Support ============

  async transaction<T>(
    fn: (provider: StorageProvider) => Promise<T>,
  ): Promise<T> {
    // In-memory storage doesn't need real transactions
    // Just execute the function directly
    return fn(this);
  }

  // ============ Lifecycle ============

  async initialize(): Promise<void> {
    // Nothing to initialize for in-memory storage
  }

  async close(): Promise<void> {
    this.clear();
  }

  // ============ Helper Methods ============

  /**
   * Clear all data (useful for testing)
   */
  clear(): void {
    this.threads.clear();
    this.chunks.clear();
    this.states.clear();
    this.steps.clear();
    this.eventQueues.clear();
    this.chunkThreadIndex.clear();
    this.stateThreadIndex.clear();
    this.stepThreadIndex.clear();
  }
}
