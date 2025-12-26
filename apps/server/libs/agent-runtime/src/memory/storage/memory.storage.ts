import { MemoryChunk } from '../types/chunk.types';
import { MemoryState } from '../types/state.types';
import { MemoryThread } from '../types/thread.types';
import { StorageProvider, ListStatesOptions } from './storage.types';

/**
 * In-memory implementation of StorageProvider
 * Useful for testing and development
 */
export class InMemoryStorageProvider implements StorageProvider {
  private threads = new Map<string, MemoryThread>();
  private chunks = new Map<string, MemoryChunk>();
  private states = new Map<string, MemoryState>();

  // Track chunk-to-thread relationships (derived from states)
  private chunkThreadIndex = new Map<string, string>();
  // Track state-to-thread relationships
  private stateThreadIndex = new Map<string, string[]>();

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
    this.states.set(state.id, state);

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
    return this.states.get(stateId) ?? null;
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

    return earliestState;
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

    return latestState;
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
        states.push(state);
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
    return states.slice(offset, offset + limit);
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
    this.chunkThreadIndex.clear();
    this.stateThreadIndex.clear();
  }
}
