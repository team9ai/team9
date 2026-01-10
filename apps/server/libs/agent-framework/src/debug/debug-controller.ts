import type { ChunkContent } from '../types/chunk.types.js';
import type { AgentEvent } from '../types/event.types.js';
import type {
  AgentOrchestrator,
  DispatchResult,
  StepResult,
} from '../manager/agent-orchestrator.js';
import type { IMemoryManager } from '../manager/memory-manager.interface.js';
import type { StorageProvider } from '../storage/storage.types.js';
import type { ReducerResult } from '../reducer/reducer.types.js';
import type {
  DebugController,
  ForkResult,
  EditResult,
  Snapshot,
} from './debug.types.js';
import type { ExecutionMode } from '../blueprint/blueprint.types.js';
import { createChunk } from '../factories/chunk.factory.js';
import { createUpdateOperation } from '../factories/operation.factory.js';
import { generateId, IdPrefix } from '../utils/id.utils.js';

/**
 * Default implementation of DebugController
 */
export class DefaultDebugController implements DebugController {
  private pausedThreads: Set<string> = new Set();
  private snapshots: Map<string, Snapshot> = new Map();

  constructor(
    private orchestrator: AgentOrchestrator,
    private storage: StorageProvider,
  ) {}

  /**
   * Get the memory manager
   */
  private get memoryManager(): IMemoryManager {
    return this.orchestrator.getMemoryManager();
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
    return this.pausedThreads.has(threadId);
  }

  /**
   * Check if a step is currently locked (being processed)
   */
  async isStepLocked(threadId: string): Promise<boolean> {
    return this.orchestrator.isStepLocked(threadId);
  }

  /**
   * Inject an event into the agent
   */
  async injectEvent(
    threadId: string,
    event: AgentEvent,
  ): Promise<DispatchResult> {
    return this.orchestrator.dispatch(threadId, event);
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
    const result = await this.memoryManager.createThread({
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

    // Build reducer result and apply through orchestrator
    const reducerResult: ReducerResult = {
      operations: [operation],
      chunks: [editedChunk],
    };

    const result = await this.orchestrator.applyReducerResult(
      threadId,
      reducerResult,
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
    const currentState = await this.memoryManager.getCurrentState(threadId);
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
      await this.memoryManager.deleteThread(snapshot.threadId);
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

    await this.memoryManager.createThread({
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

  // ============ Execution Mode Control ============

  /**
   * Get the current execution mode for a thread
   */
  getExecutionMode(threadId: string): ExecutionMode {
    return this.orchestrator.getExecutionMode(threadId);
  }

  /**
   * Set the execution mode for a thread
   */
  async setExecutionMode(threadId: string, mode: ExecutionMode): Promise<void> {
    return this.orchestrator.setExecutionMode(threadId, mode);
  }

  /**
   * Execute a single step in stepping mode
   */
  async step(threadId: string): Promise<StepResult> {
    return this.orchestrator.step(threadId);
  }

  /**
   * Check if there's a pending compaction for a thread
   */
  hasPendingCompaction(threadId: string): boolean {
    return this.orchestrator.hasPendingCompaction(threadId);
  }

  /**
   * Check if there's a pending truncation for a thread
   */
  hasPendingTruncation(threadId: string): boolean {
    return this.orchestrator.hasPendingTruncation(threadId);
  }

  /**
   * Get the number of queued events for a thread
   */
  async getQueuedEventCount(threadId: string): Promise<number> {
    return this.orchestrator.getPersistentQueueLength(threadId);
  }

  /**
   * Peek at the next event without processing it
   */
  async peekNextEvent(threadId: string): Promise<AgentEvent | null> {
    const queuedEvent = await this.orchestrator.peekPersistentEvent(threadId);
    return queuedEvent?.event ?? null;
  }
}

/**
 * Create a debug controller
 */
export function createDebugController(
  orchestrator: AgentOrchestrator,
  storage: StorageProvider,
): DebugController {
  return new DefaultDebugController(orchestrator, storage);
}
