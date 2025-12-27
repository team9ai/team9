import type { ChunkContent } from '../types/chunk.types';
import type { AgentEvent } from '../types/event.types';
import type { MemoryManager, DispatchResult } from '../manager/memory.manager';
import type { ThreadManager } from '../manager/thread.manager';
import type { StorageProvider } from '../storage/storage.types';
import type {
  DebugController,
  ForkResult,
  EditResult,
  Snapshot,
} from './debug.types';
import { createChunk } from '../factories/chunk.factory';
import { createUpdateOperation } from '../factories/operation.factory';
import { generateId, IdPrefix } from '../utils/id.utils';

/**
 * Default implementation of DebugController
 */
export class DefaultDebugController implements DebugController {
  private pausedThreads: Set<string> = new Set();
  private snapshots: Map<string, Snapshot> = new Map();

  constructor(
    private memoryManager: MemoryManager,
    private storage: StorageProvider,
  ) {}

  /**
   * Get the thread manager
   */
  private get threadManager(): ThreadManager {
    return this.memoryManager.getThreadManager();
  }

  /**
   * Pause agent execution
   */
  pause(threadId: string): void {
    this.pausedThreads.add(threadId);
    // Note: The actual blocking is handled by the EventQueue
    // This just marks the thread as paused for our tracking
  }

  /**
   * Resume agent execution
   */
  resume(threadId: string): void {
    this.pausedThreads.delete(threadId);
  }

  /**
   * Check if agent is paused
   */
  isPaused(threadId: string): boolean {
    return (
      this.pausedThreads.has(threadId) || this.memoryManager.isBlocked(threadId)
    );
  }

  /**
   * Inject an event into the agent
   */
  async injectEvent(
    threadId: string,
    event: AgentEvent,
  ): Promise<DispatchResult> {
    return this.memoryManager.dispatch(threadId, event);
  }

  /**
   * Fork a new thread from a specific state
   */
  async forkFromState(threadId: string, stateId: string): Promise<ForkResult> {
    // Get the source state
    const sourceState = await this.storage.getState(stateId);
    if (!sourceState) {
      throw new Error(`State not found: ${stateId}`);
    }

    // Get all chunks from the source state
    const chunks = await this.storage.getChunks(
      Array.from(sourceState.chunkIds),
    );
    const chunkArray = Array.from(chunks.values());

    // Create a new thread with the same chunks
    const result = await this.threadManager.createThread({
      initialChunks: chunkArray,
      custom: {
        forkedFrom: {
          threadId,
          stateId,
        },
      },
    });

    return {
      newThreadId: result.thread.id,
      newThread: result.thread,
      forkedState: result.initialState,
    };
  }

  /**
   * Edit a chunk in a specific state
   */
  async editChunk(
    threadId: string,
    stateId: string,
    chunkId: string,
    newContent: ChunkContent,
  ): Promise<EditResult> {
    // Get the state
    const state = await this.storage.getState(stateId);
    if (!state) {
      throw new Error(`State not found: ${stateId}`);
    }

    // Get the original chunk
    const originalChunk = state.chunks.get(chunkId);
    if (!originalChunk) {
      throw new Error(`Chunk not found: ${chunkId}`);
    }

    // Create a new chunk with the updated content
    const editedChunk = createChunk({
      type: originalChunk.type,
      subType: originalChunk.subType,
      content: newContent,
      retentionStrategy: originalChunk.retentionStrategy,
      mutable: originalChunk.mutable,
      priority: originalChunk.priority,
      parentIds: [originalChunk.id],
      custom: {
        ...originalChunk.metadata.custom,
        editedFrom: chunkId,
        editedAt: Date.now(),
      },
    });

    // Create an update operation
    const operation = createUpdateOperation(chunkId, editedChunk.id);

    // Apply the operation through the thread manager
    const result = await this.threadManager.applyOperations(
      threadId,
      [operation],
      [editedChunk],
    );

    return {
      thread: result.thread,
      newState: result.state,
      editedChunk,
      originalChunkId: chunkId,
    };
  }

  /**
   * Create a snapshot of the current thread state
   */
  async createSnapshot(
    threadId: string,
    description?: string,
  ): Promise<Snapshot> {
    // Get current state
    const currentState = await this.threadManager.getCurrentState(threadId);
    if (!currentState) {
      throw new Error(`Thread not found or has no state: ${threadId}`);
    }

    // Get all states in the thread
    const states = await this.storage.getStatesByThread(threadId);

    // Collect all chunk IDs from all states
    const allChunkIds = new Set<string>();
    for (const state of states) {
      for (const chunkId of state.chunkIds) {
        allChunkIds.add(chunkId);
      }
    }

    // Get all chunks
    const chunksMap = await this.storage.getChunks(Array.from(allChunkIds));
    const chunks = Array.from(chunksMap.values());

    const snapshot: Snapshot = {
      id: generateId(IdPrefix.SNAPSHOT),
      threadId,
      stateId: currentState.id,
      states: states as any[], // Cast to mutable for storage
      chunks,
      createdAt: Date.now(),
      description,
    };

    this.snapshots.set(snapshot.id, snapshot);

    return snapshot;
  }

  /**
   * Restore a thread from a snapshot
   */
  async restoreSnapshot(snapshot: Snapshot): Promise<void> {
    // First, delete the existing thread if it exists
    try {
      await this.threadManager.deleteThread(snapshot.threadId);
    } catch {
      // Thread might not exist, that's ok
    }

    // Recreate the thread with the snapshot's chunks
    // Note: This is a simplified restore that only restores the final state
    // A full restore would need to restore the entire state history
    const lastState = snapshot.states[snapshot.states.length - 1];
    if (!lastState) {
      throw new Error('Snapshot has no states');
    }

    const chunkIds = lastState.chunkIds;
    const chunks = snapshot.chunks.filter((c) => chunkIds.includes(c.id));

    await this.threadManager.createThread({
      initialChunks: chunks,
      custom: {
        restoredFrom: {
          snapshotId: snapshot.id,
          stateId: snapshot.stateId,
        },
      },
    });
  }

  /**
   * Get all snapshots for a thread
   */
  getSnapshots(threadId: string): Snapshot[] {
    return Array.from(this.snapshots.values()).filter(
      (s) => s.threadId === threadId,
    );
  }

  /**
   * Delete a snapshot
   */
  deleteSnapshot(snapshotId: string): void {
    this.snapshots.delete(snapshotId);
  }
}

/**
 * Create a debug controller
 */
export function createDebugController(
  memoryManager: MemoryManager,
  storage: StorageProvider,
): DebugController {
  return new DefaultDebugController(memoryManager, storage);
}
