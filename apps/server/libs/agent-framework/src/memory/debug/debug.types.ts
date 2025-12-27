import type { MemoryThread } from '../types/thread.types';
import type { MemoryState } from '../types/state.types';
import type { MemoryChunk, ChunkContent } from '../types/chunk.types';
import type { AgentEvent } from '../types/event.types';
import type { DispatchResult } from '../manager/memory.manager';

/**
 * Result of forking from a state
 */
export interface ForkResult {
  /** New thread ID */
  newThreadId: string;
  /** New thread */
  newThread: Readonly<MemoryThread>;
  /** Forked state (copy of the source state) */
  forkedState: Readonly<MemoryState>;
}

/**
 * Result of editing a chunk
 */
export interface EditResult {
  /** The updated thread */
  thread: Readonly<MemoryThread>;
  /** The new state with the edited chunk */
  newState: Readonly<MemoryState>;
  /** The edited chunk (new version) */
  editedChunk: MemoryChunk;
  /** Original chunk ID */
  originalChunkId: string;
}

/**
 * Snapshot of an agent's state
 */
export interface Snapshot {
  /** Snapshot ID */
  id: string;
  /** Thread ID */
  threadId: string;
  /** State ID at time of snapshot */
  stateId: string;
  /** All states in the thread */
  states: MemoryState[];
  /** All chunks in the thread */
  chunks: MemoryChunk[];
  /** Timestamp */
  createdAt: number;
  /** Optional description */
  description?: string;
}

/**
 * Debug controller interface for controlling agent execution
 */
export interface DebugController {
  /**
   * Pause agent execution
   * @param threadId - Thread ID to pause
   */
  pause(threadId: string): void;

  /**
   * Resume agent execution
   * @param threadId - Thread ID to resume
   */
  resume(threadId: string): void;

  /**
   * Check if agent is paused
   * @param threadId - Thread ID to check
   */
  isPaused(threadId: string): boolean;

  /**
   * Inject an event into the agent
   * @param threadId - Thread ID
   * @param event - Event to inject
   */
  injectEvent(threadId: string, event: AgentEvent): Promise<DispatchResult>;

  /**
   * Fork a new thread from a specific state
   * @param threadId - Source thread ID
   * @param stateId - State ID to fork from
   */
  forkFromState(threadId: string, stateId: string): Promise<ForkResult>;

  /**
   * Edit a chunk in a specific state
   * Creates a new state with the edited chunk
   * @param threadId - Thread ID
   * @param stateId - State ID containing the chunk
   * @param chunkId - Chunk ID to edit
   * @param newContent - New content for the chunk
   */
  editChunk(
    threadId: string,
    stateId: string,
    chunkId: string,
    newContent: ChunkContent,
  ): Promise<EditResult>;

  /**
   * Create a snapshot of the current thread state
   * @param threadId - Thread ID to snapshot
   * @param description - Optional description
   */
  createSnapshot(threadId: string, description?: string): Promise<Snapshot>;

  /**
   * Restore a thread from a snapshot
   * @param snapshot - Snapshot to restore
   */
  restoreSnapshot(snapshot: Snapshot): Promise<void>;

  /**
   * Get all snapshots for a thread
   * @param threadId - Thread ID
   */
  getSnapshots(threadId: string): Snapshot[];

  /**
   * Delete a snapshot
   * @param snapshotId - Snapshot ID to delete
   */
  deleteSnapshot(snapshotId: string): void;
}
