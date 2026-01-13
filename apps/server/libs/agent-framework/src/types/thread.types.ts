import type { LLMConfig } from '../llm/llm.types.js';
import type { Blueprint } from '../blueprint/blueprint.types.js';
import type { BaseEvent } from './event.types.js';

// Re-export Step types from memory-manager.interface for backward compatibility
export type {
  Step,
  StepStatus,
  LLMInteraction,
} from '../manager/memory-manager.interface.js';

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
 * Queued event for persistence
 */
export interface QueuedEvent {
  /** Unique identifier for the queued event */
  id: string;
  /** The event payload */
  event: BaseEvent;
  /** Timestamp when the event was queued */
  queuedAt: number;
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
  /** Pending event queue (persisted for recovery) */
  eventQueue?: QueuedEvent[];
  /**
   * Current step ID being executed (used as a lock)
   * When set, indicates a step is in progress and prevents concurrent execution
   * Format: step_xxx
   */
  currentStepId?: string;
  /**
   * Parent thread ID (if this is a subagent thread)
   * Links child threads to their parent for context inheritance and result propagation
   */
  parentThreadId?: string;
  /**
   * Child thread IDs (subagent threads spawned by this thread)
   * Used for tracking and monitoring subagent progress
   */
  childThreadIds?: string[];

  // ============ Blueprint Configuration ============

  /**
   * Blueprint ID that created this thread
   * Used for tracking which blueprint configuration was used
   */
  blueprintId?: string;

  /**
   * Blueprint name for identification and debugging
   */
  blueprintName?: string;

  /**
   * Blueprint key for subagent threads
   * Identifies which subagent blueprint type was used to create this thread
   * (e.g., 'researcher', 'writer', 'analyst')
   */
  blueprintKey?: string;

  /**
   * LLM configuration for this thread
   * Defines model, temperature, and other parameters for LLM calls
   */
  llmConfig?: LLMConfig;

  /**
   * Available control tools for this thread
   * Array of tool names that can be invoked (e.g., ['grep', 'read', 'write'])
   */
  tools?: string[];

  /**
   * SubAgent blueprints available for spawning child threads
   * Key is the subagent name, value is the blueprint definition
   * These blueprints can be used to create subagent threads on-demand
   */
  subAgents?: Record<string, Blueprint>;
}

/**
 * Input parameters for creating a Memory Thread
 */
export interface CreateThreadInput {
  /** Custom user-defined metadata */
  custom?: Record<string, unknown>;
  /** Parent thread ID for subagent threads */
  parentThreadId?: string;

  // ============ Blueprint Configuration ============

  /** Blueprint ID that created this thread */
  blueprintId?: string;
  /** Blueprint name for identification */
  blueprintName?: string;
  /** Blueprint key for subagent threads */
  blueprintKey?: string;
  /** LLM configuration for this thread */
  llmConfig?: LLMConfig;
  /** Available control tools */
  tools?: string[];
  /** SubAgent blueprints for spawning */
  subAgents?: Record<string, Blueprint>;
}
