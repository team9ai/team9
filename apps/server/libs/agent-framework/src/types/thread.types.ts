import { AgentEvent, EventType } from './event.types.js';
import type {
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
} from '../llm/llm.types.js';

/**
 * Step status
 */
export type StepStatus = 'running' | 'completed' | 'failed';

/**
 * LLM interaction record for debugging
 * Records what was sent to the LLM and what was received
 */
export interface LLMInteraction {
  /** Timestamp when LLM call started */
  startedAt: number;
  /** Timestamp when LLM call completed */
  completedAt?: number;
  /** Duration in milliseconds */
  duration?: number;
  /** Messages sent to LLM (the full context) */
  request: {
    messages: LLMMessage[];
    tools?: LLMToolDefinition[];
    temperature?: number;
    maxTokens?: number;
  };
  /** Response from LLM */
  response?: {
    content: string;
    toolCalls?: LLMToolCall[];
    finishReason?: 'stop' | 'tool_calls' | 'length' | 'content_filter';
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  };
  /** Error if LLM call failed */
  error?: string;
}

/**
 * Step record - tracks the lifecycle of a single event processing step
 * Each step processes one event and may produce one or more state transitions
 */
export interface Step {
  /** Unique identifier, format: step_xxx */
  id: string;
  /** Thread ID this step belongs to */
  threadId: string;
  /** The event that triggered this step (metadata only) */
  triggerEvent: {
    /** Event ID (from queued event) */
    eventId?: string;
    /** Event type */
    type: EventType | string;
    /** Event timestamp */
    timestamp: number;
  };
  /** Full event payload for debugging - contains the complete event data */
  eventPayload?: AgentEvent;
  /** LLM interaction record - captures what was sent to and received from LLM */
  llmInteraction?: LLMInteraction;
  /** Step status */
  status: StepStatus;
  /** Timestamp when the step started */
  startedAt: number;
  /** Timestamp when the step completed (undefined if still running) */
  completedAt?: number;
  /** Duration in milliseconds (undefined if still running) */
  duration?: number;
  /** State ID before this step */
  previousStateId?: string;
  /** State ID after this step (undefined if still running or failed) */
  resultStateId?: string;
  /** Error message if step failed */
  error?: string;
  /** Additional context */
  context?: Record<string, unknown>;
}

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
  event: AgentEvent;
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
   * Flag indicating whether the agent needs to generate a response
   * Set to true after user input, set to false after LLM response
   * Used in stepping mode to determine if LLM should run
   */
  needsResponse?: boolean;
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
  /**
   * Blueprint key for subagent threads
   * Identifies which subagent blueprint was used to create this thread
   */
  blueprintKey?: string;
}

/**
 * Input parameters for creating a Memory Thread
 */
export interface CreateThreadInput {
  custom?: Record<string, unknown>;
  /** Parent thread ID for subagent threads */
  parentThreadId?: string;
  /** Blueprint key for subagent threads */
  blueprintKey?: string;
}
