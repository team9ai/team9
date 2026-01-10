import { MemoryChunk } from './chunk.types.js';
import { Operation } from './operation.types.js';

/**
 * Provenance information for state transition traceability
 * Records the event, step, and operation that caused this state transition
 */
export interface StateProvenance {
  /** The event that triggered this state transition */
  eventId?: string;
  /** The event type that triggered this transition */
  eventType?: string;
  /** The step ID during which this transition occurred (in stepping mode) */
  stepId?: string;
  /** The step number (sequential counter within this execution) */
  stepNumber?: number;
  /** The operation that was applied to create this state */
  operation?: Operation;
  /** Source of the transition: 'event_dispatch' | 'compaction' | 'truncation' | 'manual' | 'fork' */
  source?:
    | 'event_dispatch'
    | 'compaction'
    | 'truncation'
    | 'manual'
    | 'fork'
    | 'initial';
  /** Timestamp when the transition occurred */
  timestamp?: number;
  /** Additional context about the transition */
  context?: Record<string, unknown>;
}

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
  /** Provenance information for traceability */
  provenance?: StateProvenance;
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
  /**
   * Flag indicating whether the LLM needs to continue generating a response
   * Set based on event's llmResponseRequirement during state transition
   */
  needLLMContinueResponse?: boolean;
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
  needLLMContinueResponse?: boolean;
}

/**
 * Input parameters for creating a Memory State
 */
export interface CreateStateInput {
  threadId?: string;
  chunks?: MemoryChunk[];
  previousStateId?: string;
  sourceOperation?: Operation;
  /** Provenance information for traceability */
  provenance?: StateProvenance;
  custom?: Record<string, unknown>;
  /** Initial value for needLLMContinueResponse */
  needLLMContinueResponse?: boolean;
}
