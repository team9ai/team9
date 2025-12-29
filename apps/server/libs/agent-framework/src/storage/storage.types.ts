import { MemoryChunk } from '../types/chunk.types.js';
import { MemoryState } from '../types/state.types.js';
import { MemoryThread, Step } from '../types/thread.types.js';

/**
 * Query options for listing states
 */
export interface ListStatesOptions {
  /** Maximum number of states to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Filter by thread ID */
  threadId?: string;
  /** Filter by timestamp range (start) */
  fromTimestamp?: number;
  /** Filter by timestamp range (end) */
  toTimestamp?: number;
}

/**
 * Query options for listing chunks
 */
export interface ListChunksOptions {
  /** Maximum number of chunks to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Filter by thread ID */
  threadId?: string;
  /** Filter by state ID */
  stateId?: string;
}

/**
 * Storage Provider interface
 * Defines the contract for persisting memory data
 */
export interface StorageProvider {
  // ============ Thread Operations ============

  /**
   * Save a thread to storage
   * @param thread - The thread to save
   */
  saveThread(thread: MemoryThread): Promise<void>;

  /**
   * Get a thread by ID
   * @param threadId - The thread ID
   * @returns The thread or null if not found
   */
  getThread(threadId: string): Promise<MemoryThread | null>;

  /**
   * Update a thread
   * @param thread - The thread to update
   */
  updateThread(thread: MemoryThread): Promise<void>;

  /**
   * Delete a thread by ID
   * @param threadId - The thread ID
   */
  deleteThread(threadId: string): Promise<void>;

  // ============ Chunk Operations ============

  /**
   * Save a chunk to storage
   * @param chunk - The chunk to save
   */
  saveChunk(chunk: MemoryChunk): Promise<void>;

  /**
   * Save multiple chunks to storage
   * @param chunks - The chunks to save
   */
  saveChunks(chunks: MemoryChunk[]): Promise<void>;

  /**
   * Get a chunk by ID
   * @param chunkId - The chunk ID
   * @returns The chunk or null if not found
   */
  getChunk(chunkId: string): Promise<MemoryChunk | null>;

  /**
   * Get multiple chunks by IDs
   * @param chunkIds - The chunk IDs
   * @returns Map of chunk ID to chunk (missing chunks are omitted)
   */
  getChunks(chunkIds: string[]): Promise<Map<string, MemoryChunk>>;

  /**
   * Get all chunks for a thread
   * @param threadId - The thread ID
   * @returns Array of chunks belonging to the thread
   */
  getChunksByThread(threadId: string): Promise<MemoryChunk[]>;

  /**
   * Delete a chunk by ID
   * @param chunkId - The chunk ID
   */
  deleteChunk(chunkId: string): Promise<void>;

  // ============ State Operations ============

  /**
   * Save a state to storage
   * @param state - The state to save
   */
  saveState(state: MemoryState): Promise<void>;

  /**
   * Get a state by ID
   * @param stateId - The state ID
   * @returns The state or null if not found
   */
  getState(stateId: string): Promise<MemoryState | null>;

  /**
   * Get the initial (first) state for a thread
   * @param threadId - The thread ID
   * @returns The initial state or null if not found
   */
  getInitialState(threadId: string): Promise<MemoryState | null>;

  /**
   * Get the latest state for a thread
   * @param threadId - The thread ID
   * @returns The latest state or null if not found
   */
  getLatestState(threadId: string): Promise<MemoryState | null>;

  /**
   * Get all states for a thread
   * @param threadId - The thread ID
   * @returns Array of states belonging to the thread (ordered by creation time)
   */
  getStatesByThread(threadId: string): Promise<MemoryState[]>;

  /**
   * List states with optional filtering
   * @param options - Query options
   * @returns Array of states
   */
  listStates(options?: ListStatesOptions): Promise<MemoryState[]>;

  /**
   * Delete a state by ID
   * @param stateId - The state ID
   */
  deleteState(stateId: string): Promise<void>;

  // ============ Step Operations ============

  /**
   * Save a step to storage
   * @param step - The step to save
   */
  saveStep(step: Step): Promise<void>;

  /**
   * Get a step by ID
   * @param stepId - The step ID
   * @returns The step or null if not found
   */
  getStep(stepId: string): Promise<Step | null>;

  /**
   * Update a step (e.g., when completing)
   * @param step - The step to update
   */
  updateStep(step: Step): Promise<void>;

  /**
   * Get all steps for a thread
   * @param threadId - The thread ID
   * @returns Array of steps belonging to the thread (ordered by start time)
   */
  getStepsByThread(threadId: string): Promise<Step[]>;

  /**
   * Delete a step by ID
   * @param stepId - The step ID
   */
  deleteStep(stepId: string): Promise<void>;

  // ============ Transaction Support ============

  /**
   * Execute multiple operations in a transaction
   * @param fn - The function to execute within the transaction
   * @returns The result of the function
   */
  transaction<T>(fn: (provider: StorageProvider) => Promise<T>): Promise<T>;

  // ============ Lifecycle ============

  /**
   * Initialize the storage provider
   */
  initialize(): Promise<void>;

  /**
   * Close the storage provider and release resources
   */
  close(): Promise<void>;
}

/**
 * Storage provider factory function type
 */
export type StorageProviderFactory = () =>
  | StorageProvider
  | Promise<StorageProvider>;
