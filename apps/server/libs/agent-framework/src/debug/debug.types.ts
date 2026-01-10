import type { MemoryThread } from '../types/thread.types.js';
import type { MemoryState } from '../types/state.types.js';
import type { MemoryChunk, ChunkContent } from '../types/chunk.types.js';
import type { AgentEvent } from '../types/event.types.js';
import type {
  DispatchResult,
  StepResult,
} from '../manager/agent-orchestrator.js';
import type { ExecutionMode } from '../blueprint/blueprint.types.js';

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

  // ============ Execution Mode Control ============

  /**
   * Get the current execution mode for a thread
   * @param threadId - Thread ID
   * @returns The current execution mode ('auto' or 'stepping')
   */
  getExecutionMode(threadId: string): ExecutionMode;

  /**
   * Set the execution mode for a thread
   * - 'auto': Events are processed immediately
   * - 'stepping': Events are queued until step() is called
   *
   * When switching from 'stepping' to 'auto', all queued events are processed.
   *
   * @param threadId - Thread ID
   * @param mode - The execution mode to set
   */
  setExecutionMode(threadId: string, mode: ExecutionMode): Promise<void>;

  /**
   * Execute a single step in stepping mode
   * If there's a pending compaction, it will be executed first.
   * Otherwise, processes the next queued event.
   *
   * @param threadId - Thread ID
   * @returns The result of the step operation
   * @throws Error if not in stepping mode
   */
  step(threadId: string): Promise<StepResult>;

  /**
   * Check if there's a pending compaction for a thread
   * @param threadId - Thread ID
   * @returns true if compaction is pending
   */
  hasPendingCompaction(threadId: string): boolean;

  /**
   * Check if there's a pending truncation for a thread
   * @param threadId - Thread ID
   * @returns true if truncation is pending
   */
  hasPendingTruncation(threadId: string): boolean;

  /**
   * Check if a step is currently locked (being processed)
   * @param threadId - Thread ID
   * @returns true if step is locked
   */
  isStepLocked(threadId: string): Promise<boolean>;

  /**
   * Get the number of queued events for a thread
   * @param threadId - Thread ID
   * @returns Number of events in the queue
   */
  getQueuedEventCount(threadId: string): Promise<number>;

  /**
   * Peek at the next event without processing it
   * @param threadId - Thread ID
   * @returns The next event or null if queue is empty
   */
  peekNextEvent(threadId: string): Promise<AgentEvent | null>;
}
