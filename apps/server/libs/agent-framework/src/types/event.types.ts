/**
 * Event types that trigger state changes in Agent memory
 */

// ============ Event Dispatch Strategy ============

/**
 * Strategy for handling event dispatch when agent is processing
 *
 * - queue: (default) Queue the event, process after current operation completes
 * - interrupt: Cancel current generation, immediately process new event
 * - terminate: End the agent's event loop, transition to completed/error state
 * - silent: Store only, do not trigger any processing flow (reserved for future use)
 */
export type EventDispatchStrategy =
  | 'queue'
  | 'interrupt'
  | 'terminate'
  | 'silent';

/**
 * Get the default dispatch strategy for an event type
 * Most events default to 'queue', with specific overrides below
 */
export function getDefaultDispatchStrategy(
  eventType: EventType,
): EventDispatchStrategy {
  switch (eventType) {
    // Terminate events - end the agent's event loop
    case EventType.TASK_COMPLETED:
    case EventType.TASK_ABANDONED:
    case EventType.TASK_TERMINATED:
      return 'terminate';

    // All other events queue by default
    default:
      return 'queue';
  }
}

// ============ LLM Response Requirement ============

/**
 * Requirement for LLM response after processing an event
 *
 * - need: LLM should generate a response (e.g., after user message)
 * - no_need: LLM should NOT generate a response (e.g., after task completion)
 * - keep: Keep the previous state's value (default for most events)
 */
export type LLMResponseRequirement = 'need' | 'no_need' | 'keep';

// ============ Event Type Enum ============

export enum EventType {
  // Error Events
  TOOL_ERROR = 'TOOL_ERROR',
  SUBAGENT_ERROR = 'SUBAGENT_ERROR',
  SKILL_ERROR = 'SKILL_ERROR',
  SYSTEM_ERROR = 'SYSTEM_ERROR',

  // Input Events
  USER_MESSAGE = 'USER_MESSAGE',
  PARENT_AGENT_MESSAGE = 'PARENT_AGENT_MESSAGE',

  // LLM Response Events
  LLM_TEXT_RESPONSE = 'LLM_TEXT_RESPONSE',
  LLM_TOOL_CALL = 'LLM_TOOL_CALL',
  LLM_SKILL_CALL = 'LLM_SKILL_CALL',
  LLM_SUBAGENT_SPAWN = 'LLM_SUBAGENT_SPAWN',
  LLM_SUBAGENT_MESSAGE = 'LLM_SUBAGENT_MESSAGE',
  LLM_CLARIFICATION = 'LLM_CLARIFICATION',

  // Response Events
  TOOL_RESULT = 'TOOL_RESULT',
  SKILL_RESULT = 'SKILL_RESULT',
  SUBAGENT_RESULT = 'SUBAGENT_RESULT',

  // Control Events - Task Lifecycle
  TASK_COMPLETED = 'TASK_COMPLETED',
  TASK_ABANDONED = 'TASK_ABANDONED',
  TASK_TERMINATED = 'TASK_TERMINATED',

  // Control Events - TODO Management
  TODO_SET = 'TODO_SET',
  TODO_COMPLETED = 'TODO_COMPLETED',
  TODO_EXPANDED = 'TODO_EXPANDED',
  TODO_UPDATED = 'TODO_UPDATED',
  TODO_DELETED = 'TODO_DELETED',

  // Control Events - Memory Management
  MEMORY_MARK_CRITICAL = 'MEMORY_MARK_CRITICAL',
  MEMORY_FORGET = 'MEMORY_FORGET',

  // Memory Compact Events
  MEMORY_COMPACT_MANUAL = 'MEMORY_COMPACT_MANUAL',
  MEMORY_COMPACT_AUTO = 'MEMORY_COMPACT_AUTO',

  // External Events
  EXTERNAL_INJECT = 'EXTERNAL_INJECT',
  EXTERNAL_TIMER = 'EXTERNAL_TIMER',
  ENVIRONMENT_CHANGE = 'ENVIRONMENT_CHANGE',

  // Lifecycle Events
  EXECUTION_RETRY = 'EXECUTION_RETRY',
  EXECUTION_RESUME = 'EXECUTION_RESUME',
  EXECUTION_PAUSE = 'EXECUTION_PAUSE',

  // Component Events (hot-plug)
  COMPONENT_ENABLE = 'COMPONENT_ENABLE',
  COMPONENT_DISABLE = 'COMPONENT_DISABLE',
  COMPONENT_DATA_UPDATE = 'COMPONENT_DATA_UPDATE',
}

// ============ Base Event Interface ============

export interface BaseEvent {
  /** Event type */
  type: EventType;
  /** Timestamp when event occurred */
  timestamp: number;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
  /**
   * Override the default dispatch strategy for this specific event
   * If not specified, uses the default strategy for the event type
   */
  dispatchStrategy?: EventDispatchStrategy;
  /**
   * Requirement for LLM response after processing this event
   * - 'need': LLM should generate a response
   * - 'no_need': LLM should NOT generate a response
   * - 'keep': Keep the previous state's value (default if not specified)
   */
  llmResponseRequirement?: LLMResponseRequirement;
}

// ============ Error Events ============

export interface ToolErrorEvent extends BaseEvent {
  type: EventType.TOOL_ERROR;
  /** Tool that failed */
  toolName: string;
  /** Tool call ID */
  callId: string;
  /** Error message */
  error: string;
  /** Error details */
  errorDetails?: unknown;
}

export interface SubAgentErrorEvent extends BaseEvent {
  type: EventType.SUBAGENT_ERROR;
  /** SubAgent ID */
  subAgentId: string;
  /** Error message */
  error: string;
  /** Error details */
  errorDetails?: unknown;
}

export interface SkillErrorEvent extends BaseEvent {
  type: EventType.SKILL_ERROR;
  /** Skill name */
  skillName: string;
  /** Skill call ID */
  callId: string;
  /** Error message */
  error: string;
  /** Error details */
  errorDetails?: unknown;
}

export interface SystemErrorEvent extends BaseEvent {
  type: EventType.SYSTEM_ERROR;
  /** Error code */
  code: string;
  /** Error message */
  error: string;
  /** Error details */
  errorDetails?: unknown;
}

// ============ Input Events ============

export interface UserMessageEvent extends BaseEvent {
  type: EventType.USER_MESSAGE;
  /** Message content */
  content: string;
  /** Optional attachments */
  attachments?: unknown[];
}

export interface ParentAgentMessageEvent extends BaseEvent {
  type: EventType.PARENT_AGENT_MESSAGE;
  /** Parent agent ID */
  parentAgentId: string;
  /** Message content */
  content: string;
  /** Task context */
  taskContext?: Record<string, unknown>;
}

// ============ LLM Response Events ============

export interface LLMTextResponseEvent extends BaseEvent {
  type: EventType.LLM_TEXT_RESPONSE;
  /** Response content */
  content: string;
  /** Model used */
  model?: string;
  /** Token usage */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMToolCallEvent extends BaseEvent {
  type: EventType.LLM_TOOL_CALL;
  /** Tool name */
  toolName: string;
  /** Tool call ID */
  callId: string;
  /** Tool arguments */
  arguments: Record<string, unknown>;
}

export interface LLMSkillCallEvent extends BaseEvent {
  type: EventType.LLM_SKILL_CALL;
  /** Skill name */
  skillName: string;
  /** Skill call ID */
  callId: string;
  /** Skill input */
  input: unknown;
}

export interface LLMSubAgentSpawnEvent extends BaseEvent {
  type: EventType.LLM_SUBAGENT_SPAWN;
  /** SubAgent ID */
  subAgentId: string;
  /** SubAgent type/role */
  agentType: string;
  /** Initial task/instruction */
  task: string;
  /** Configuration */
  config?: Record<string, unknown>;
}

export interface LLMSubAgentMessageEvent extends BaseEvent {
  type: EventType.LLM_SUBAGENT_MESSAGE;
  /** Target SubAgent ID */
  subAgentId: string;
  /** Message content */
  content: string;
}

export interface LLMClarificationEvent extends BaseEvent {
  type: EventType.LLM_CLARIFICATION;
  /** Clarification question */
  question: string;
  /** What information is needed */
  neededInfo?: string[];
}

// ============ Response Events ============

export interface ToolResultEvent extends BaseEvent {
  type: EventType.TOOL_RESULT;
  /** Tool name */
  toolName: string;
  /** Tool call ID */
  callId: string;
  /** Result content */
  result: unknown;
  /** Whether execution was successful */
  success: boolean;
}

export interface SkillResultEvent extends BaseEvent {
  type: EventType.SKILL_RESULT;
  /** Skill name */
  skillName: string;
  /** Skill call ID */
  callId: string;
  /** Result content */
  result: unknown;
  /** Whether execution was successful */
  success: boolean;
}

export interface SubAgentResultEvent extends BaseEvent {
  type: EventType.SUBAGENT_RESULT;
  /** SubAgent ID (the subagent key, not the thread ID) */
  subAgentId: string;
  /** Child thread ID (the actual thread ID of the subagent) */
  childThreadId?: string;
  /** Result content */
  result: unknown;
  /** Whether task was successful */
  success: boolean;
}

// ============ Control Events - Task Lifecycle ============

export interface TaskCompletedEvent extends BaseEvent {
  type: EventType.TASK_COMPLETED;
  /** Completion result */
  result: unknown;
  /** Summary of what was done */
  summary?: string;
}

export interface TaskAbandonedEvent extends BaseEvent {
  type: EventType.TASK_ABANDONED;
  /** Reason for abandonment */
  reason: string;
  /** Partial progress if any */
  partialResult?: unknown;
}

export interface TaskTerminatedEvent extends BaseEvent {
  type: EventType.TASK_TERMINATED;
  /** Who terminated (user/system/parent) */
  terminatedBy: 'user' | 'system' | 'parent';
  /** Reason for termination */
  reason?: string;
}

// ============ Control Events - TODO Management ============

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  children?: TodoItem[];
}

export interface TodoSetEvent extends BaseEvent {
  type: EventType.TODO_SET;
  /** TODO tree */
  todos: TodoItem[];
}

export interface TodoCompletedEvent extends BaseEvent {
  type: EventType.TODO_COMPLETED;
  /** TODO item ID */
  todoId: string;
  /** Completion result */
  result?: unknown;
}

export interface TodoExpandedEvent extends BaseEvent {
  type: EventType.TODO_EXPANDED;
  /** Parent TODO item ID */
  todoId: string;
  /** New sub-items */
  subItems: TodoItem[];
}

export interface TodoUpdatedEvent extends BaseEvent {
  type: EventType.TODO_UPDATED;
  /** TODO item ID */
  todoId: string;
  /** Updated content */
  content?: string;
  /** Updated status */
  status?: TodoItem['status'];
}

export interface TodoDeletedEvent extends BaseEvent {
  type: EventType.TODO_DELETED;
  /** TODO item ID to delete */
  todoId: string;
}

// ============ Control Events - Memory Management ============

export interface MemoryMarkCriticalEvent extends BaseEvent {
  type: EventType.MEMORY_MARK_CRITICAL;
  /** Chunk IDs to mark as critical */
  chunkIds: string[];
}

export interface MemoryForgetEvent extends BaseEvent {
  type: EventType.MEMORY_FORGET;
  /** Chunk IDs to forget */
  chunkIds: string[];
}

// ============ Memory Compact Events ============

export interface MemoryCompactManualEvent extends BaseEvent {
  type: EventType.MEMORY_COMPACT_MANUAL;
  /** Chunk IDs to compact */
  chunkIds?: string[];
}

export interface MemoryCompactAutoEvent extends BaseEvent {
  type: EventType.MEMORY_COMPACT_AUTO;
  /** Threshold that triggered compaction */
  threshold: number;
  /** Current memory size/count */
  currentSize: number;
}

// ============ External Events ============

export interface ExternalInjectEvent extends BaseEvent {
  type: EventType.EXTERNAL_INJECT;
  /** Source of injection */
  source: string;
  /** Injected content */
  content: unknown;
}

export interface ExternalTimerEvent extends BaseEvent {
  type: EventType.EXTERNAL_TIMER;
  /** Timer ID */
  timerId: string;
  /** Timer payload */
  payload?: unknown;
}

export interface EnvironmentChangeEvent extends BaseEvent {
  type: EventType.ENVIRONMENT_CHANGE;
  /** What changed */
  changeType: string;
  /** Old value */
  oldValue?: unknown;
  /** New value */
  newValue?: unknown;
}

// ============ Lifecycle Events ============

export interface ExecutionRetryEvent extends BaseEvent {
  type: EventType.EXECUTION_RETRY;
  /** What is being retried */
  retryTarget: string;
  /** Retry attempt number */
  attemptNumber: number;
  /** Previous error */
  previousError?: string;
}

export interface ExecutionResumeEvent extends BaseEvent {
  type: EventType.EXECUTION_RESUME;
  /** State ID to resume from */
  resumeFromStateId?: string;
}

export interface ExecutionPauseEvent extends BaseEvent {
  type: EventType.EXECUTION_PAUSE;
  /** Reason for pause */
  reason?: string;
}

// ============ Component Events ============

export interface ComponentEnableEvent extends BaseEvent {
  type: EventType.COMPONENT_ENABLE;
  /** Component ID to enable */
  componentId: string;
  /** Optional configuration to pass to component */
  config?: Record<string, unknown>;
}

export interface ComponentDisableEvent extends BaseEvent {
  type: EventType.COMPONENT_DISABLE;
  /** Component ID to disable */
  componentId: string;
  /** Whether to preserve component data for re-enabling later */
  preserveData?: boolean;
}

export interface ComponentDataUpdateEvent extends BaseEvent {
  type: EventType.COMPONENT_DATA_UPDATE;
  /** Component ID */
  componentId: string;
  /** Data key to update */
  key: string;
  /** New value */
  value: unknown;
}

// ============ Union Type ============

export type AgentEvent =
  // Error Events
  | ToolErrorEvent
  | SubAgentErrorEvent
  | SkillErrorEvent
  | SystemErrorEvent
  // Input Events
  | UserMessageEvent
  | ParentAgentMessageEvent
  // LLM Response Events
  | LLMTextResponseEvent
  | LLMToolCallEvent
  | LLMSkillCallEvent
  | LLMSubAgentSpawnEvent
  | LLMSubAgentMessageEvent
  | LLMClarificationEvent
  // Response Events
  | ToolResultEvent
  | SkillResultEvent
  | SubAgentResultEvent
  // Control Events - Task Lifecycle
  | TaskCompletedEvent
  | TaskAbandonedEvent
  | TaskTerminatedEvent
  // Control Events - TODO Management
  | TodoSetEvent
  | TodoCompletedEvent
  | TodoExpandedEvent
  | TodoUpdatedEvent
  | TodoDeletedEvent
  // Control Events - Memory Management
  | MemoryMarkCriticalEvent
  | MemoryForgetEvent
  // Memory Compact Events
  | MemoryCompactManualEvent
  | MemoryCompactAutoEvent
  // External Events
  | ExternalInjectEvent
  | ExternalTimerEvent
  | EnvironmentChangeEvent
  // Lifecycle Events
  | ExecutionRetryEvent
  | ExecutionResumeEvent
  | ExecutionPauseEvent
  // Component Events
  | ComponentEnableEvent
  | ComponentDisableEvent
  | ComponentDataUpdateEvent;
