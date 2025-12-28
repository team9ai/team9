/**
 * Blueprint chunk content types
 */
export interface TextContent {
  type: "TEXT";
  text: string;
}

export interface ImageContent {
  type: "IMAGE";
  data: string;
  mimeType: string;
  altText?: string;
}

export interface MixedContent {
  type: "MIXED";
  parts: Array<TextContent | ImageContent>;
}

export type ChunkContent =
  | TextContent
  | ImageContent
  | MixedContent
  | Record<string, unknown>;

/**
 * Blueprint chunk definition
 */
export interface BlueprintChunk {
  type: string;
  subType?: string;
  content: ChunkContent;
  retentionStrategy?: string;
  mutable?: boolean;
  priority?: number;
}

/**
 * LLM configuration
 */
export interface LLMConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

/**
 * Execution mode for agent event processing
 */
export type ExecutionMode = "auto" | "stepping";

/**
 * Strategy for handling event dispatch when agent is processing
 *
 * - queue: (default) Queue the event, process after current operation completes
 * - interrupt: Cancel current generation, immediately process new event
 * - terminate: End the agent's event loop, transition to completed/error state
 * - silent: Store only, do not trigger any processing flow (reserved for future use)
 */
export type EventDispatchStrategy =
  | "queue"
  | "interrupt"
  | "terminate"
  | "silent";

/**
 * Blueprint definition
 */
export interface Blueprint {
  id?: string;
  name: string;
  description?: string;
  initialChunks: BlueprintChunk[];
  llmConfig: LLMConfig;
  tools?: string[];
  autoCompactThreshold?: number;
  executionMode?: ExecutionMode;
  subAgents?: Record<string, Blueprint>;
}

/**
 * Agent status
 * - processing: Agent is actively generating content or executing LLM calls
 * - waiting_internal: Agent is waiting for sub-agent or tool to return
 * - awaiting_input: Agent is waiting for external input (human/external system)
 * - paused: Agent is paused in stepping mode, waiting for manual step
 * - completed: Agent has completed its task
 * - error: Agent encountered an error
 */
export type AgentStatus =
  | "processing"
  | "waiting_internal"
  | "awaiting_input"
  | "paused"
  | "completed"
  | "error";

/**
 * Agent instance
 */
export interface AgentInstance {
  id: string;
  blueprintId?: string;
  name: string;
  threadId: string;
  status: AgentStatus;
  executionMode: ExecutionMode;
  llmConfig: LLMConfig;
  modelOverride?: LLMConfig;
  createdAt: number;
  updatedAt: number;
  parentAgentId?: string;
  subAgentIds: string[];
}

/**
 * Execution mode status
 */
export interface ExecutionModeStatus {
  mode: ExecutionMode;
  queuedEventCount: number;
  hasPendingCompaction: boolean;
  nextEvent?: unknown;
}

/**
 * Step result
 */
export interface StepResult {
  compactionPerformed: boolean;
  remainingEvents: number;
  hasDispatchResult: boolean;
  dispatchResult: {
    stateId: string;
    addedChunks: number;
    removedChunkIds: string[];
  } | null;
}

/**
 * Step status
 */
export type StepStatus = "running" | "completed" | "failed";

/**
 * Agent event payload (for debugging)
 */
export interface AgentEventPayload {
  type: string;
  timestamp: number;
  content?: unknown;
  toolName?: string;
  toolCallId?: string;
  result?: unknown;
  dispatchStrategy?: string;
  [key: string]: unknown;
}

/**
 * LLM message for request context
 */
export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * LLM tool call
 */
export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * LLM tool definition
 */
export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

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
    finishReason?: "stop" | "tool_calls" | "length" | "content_filter";
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
    type: string;
    /** Event timestamp */
    timestamp: number;
  };
  /** Full event payload for debugging - contains the complete event data */
  eventPayload?: AgentEventPayload;
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
 * Working flow child item
 */
export interface WorkingFlowChild {
  id: string;
  subType: string;
  content: ChunkContent;
  createdAt: number;
  custom?: Record<string, unknown>;
}

/**
 * Memory chunk
 */
export interface MemoryChunk {
  id: string;
  type: string;
  subType?: string;
  content: ChunkContent;
  children?: WorkingFlowChild[];
  retentionStrategy: string;
  mutable: boolean;
  priority: number;
  metadata: {
    createdAt: number;
    parentIds?: string[];
    custom?: Record<string, unknown>;
  };
}

/**
 * State provenance - records what caused a state transition
 */
export interface StateProvenance {
  /** The event ID that triggered this state transition */
  eventId?: string;
  /** The event type that triggered this transition */
  eventType?: string;
  /** The step ID during which this transition occurred (in stepping mode) */
  stepId?: string;
  /** Source of the transition */
  source?:
    | "event_dispatch"
    | "compaction"
    | "truncation"
    | "manual"
    | "fork"
    | "initial";
  /** Timestamp when the transition occurred */
  timestamp?: number;
  /** Additional context about the transition */
  context?: Record<string, unknown>;
}

/**
 * Memory state
 */
export interface MemoryState {
  id: string;
  threadId: string;
  version: number;
  createdAt: number;
  chunks: MemoryChunk[];
  operationIds: string[];
  /** Provenance information for state transition traceability */
  provenance?: StateProvenance;
  /** Previous state ID for state chain tracking */
  previousStateId?: string;
}

/**
 * State summary (for list views)
 */
export interface StateSummary {
  id: string;
  threadId: string;
  version: number;
  createdAt: number;
  chunkCount: number;
  /** Provenance summary */
  provenance?: {
    eventType?: string;
    source?: string;
  };
  /** Previous state ID */
  previousStateId?: string;
}

/**
 * SSE event types
 */
export type SSEEventType =
  | "connected"
  | "heartbeat"
  | "state:change"
  | "event:dispatch"
  | "reducer:execute"
  | "agent:paused"
  | "agent:resumed"
  | "agent:thinking"
  | "agent:response"
  | "agent:error"
  | "agent:status_changed"
  | "agent:mode_changed"
  | "agent:stepped"
  | "subagent:spawn"
  | "subagent:result"
  | "compaction:start"
  | "compaction:end"
  | "error";

/**
 * State change event data
 */
export interface StateChangeEvent {
  threadId: string;
  previousStateId: string;
  newStateId: string;
  triggerEventType: string;
  reducerName: string;
  addedChunks: MemoryChunk[];
  removedChunkIds: string[];
}

/**
 * Event dispatch event data
 */
export interface EventDispatchEvent {
  threadId: string;
  eventType: string;
  timestamp: number;
}

/**
 * SubAgent spawn event data
 */
export interface SubAgentSpawnEvent {
  parentThreadId: string;
  subAgentId: string;
  agentType: string;
  task: string;
}

/**
 * SubAgent result event data
 */
export interface SubAgentResultEvent {
  parentThreadId: string;
  subAgentId: string;
  result: unknown;
  success: boolean;
}

/**
 * Execution tree node
 */
export interface ExecutionNode {
  id: string;
  stateId: string;
  version: number;
  triggerEvent?: {
    type: string;
    timestamp: number;
  };
  reducerName?: string;
  children: ExecutionNode[];
  isSubAgent?: boolean;
  subAgentId?: string;
  parentNodeId?: string;
}

/**
 * Batch test configuration
 */
export interface BatchTestConfig {
  blueprintId: string;
  concurrency: number;
  inputEvent: unknown;
  modelOverride?: LLMConfig;
  timeout?: number;
}

/**
 * Batch test instance result
 */
export interface BatchTestInstanceResult {
  instanceId: string;
  finalState?: MemoryState;
  outputContent?: string;
  executionTime: number;
  tokenUsage?: { input: number; output: number };
  error?: string;
  status: "success" | "error" | "timeout";
}

/**
 * Batch test result
 */
export interface BatchTestResult {
  id: string;
  status: "running" | "completed" | "failed";
  config: BatchTestConfig;
  instances: BatchTestInstanceResult[];
  summary?: {
    totalTime: number;
    avgTime: number;
    successRate: number;
    successCount: number;
    errorCount: number;
  };
  createdAt: number;
  completedAt?: number;
}
