/**
 * Memory Thread metadata
 */
export interface ThreadMetadata {
  /** Creation timestamp */
  createdAt: number;
  /** Last updated timestamp */
  updatedAt: number;
  /** Custom metadata */
  custom?: Record<string, unknown>;
}

/**
 * Memory Thread interface
 * Represents an agent's memory session, containing a series of Memory States
 */
export interface MemoryThread {
  /** Unique identifier, format: thread_xxx */
  id: string;
  /** Current (latest) state ID */
  currentStateId?: string;
  /** Initial state ID */
  initialStateId?: string;
  /** Thread metadata */
  metadata: ThreadMetadata;
}

/**
 * Input parameters for creating a Memory Thread
 */
export interface CreateThreadInput {
  custom?: Record<string, unknown>;
}
