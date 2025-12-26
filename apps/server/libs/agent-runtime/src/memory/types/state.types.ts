import { MemoryChunk } from './chunk.types';
import { Operation } from './operation.types';

/**
 * Memory State metadata
 */
export interface StateMetadata {
  /** Creation timestamp */
  createdAt: number;
  /** Previous state ID (for state transition tracking) */
  previousStateId?: string;
  /** The operation that produced this state from the previous state */
  sourceOperation?: Operation;
  /** Custom metadata */
  custom?: Record<string, unknown>;
}

/**
 * Memory State interface
 * Represents the agent's current memory state, containing multiple Memory Chunks
 * This is a pure data object that acts as a state machine state
 */
export interface MemoryState {
  /** Unique identifier, format: state_xxx */
  id: string;
  /** Thread ID this state belongs to (optional, can exist independently) */
  threadId?: string;
  /** Ordered list of Chunk IDs in this state */
  chunkIds: string[];
  /** Map of Chunk ID to Chunk data for quick lookup */
  chunks: ReadonlyMap<string, MemoryChunk>;
  /** State metadata */
  metadata: StateMetadata;
}

/**
 * Serializable version of MemoryState (for storage/transport)
 */
export interface SerializableMemoryState {
  id: string;
  threadId?: string;
  chunkIds: string[];
  chunks: Record<string, MemoryChunk>;
  metadata: StateMetadata;
}

/**
 * Input parameters for creating a Memory State
 */
export interface CreateStateInput {
  threadId?: string;
  chunks?: MemoryChunk[];
  previousStateId?: string;
  sourceOperation?: Operation;
  custom?: Record<string, unknown>;
}
