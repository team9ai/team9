import type {
  BaseEvent,
  MemoryState,
  MemoryChunk,
  ChunkContent,
  LLMConfig,
  ExecutionMode,
  StepResult,
  AgentStatus,
  EventDispatchStrategy,
  Agent,
} from '@team9/agent-framework';
import type { AgentExecutor } from '../executor/agent-executor.js';

// Re-export for convenience
export type { ExecutionMode, StepResult, AgentStatus, EventDispatchStrategy };

/**
 * Shared runtime state container for agent services
 * All services share this state to access agent runtime components
 */
export interface AgentRuntimeState {
  /** Cached agent instances by ID */
  agentsCache: Map<string, AgentInstance>;
  /** Agent instances by ID (boot API Agent wrapper) */
  agents: Map<string, Agent>;
  /** Executors by agent ID */
  executors: Map<string, AgentExecutor>;
}

/**
 * Blueprint definition for creating agents
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
 * Chunk definition in blueprint (simplified for JSON)
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
 * Runtime agent instance
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
  /** Tool names available to this agent */
  tools?: string[];
  createdAt: number;
  updatedAt: number;
  parentAgentId?: string;
  subAgentIds: string[];
}

/**
 * Execution mode status for API response
 */
export interface ExecutionModeStatus {
  mode: ExecutionMode;
}

/**
 * Set execution mode request
 */
export interface SetExecutionModeRequest {
  mode: ExecutionMode;
}

/**
 * Create agent request
 */
export interface CreateAgentRequest {
  blueprint: Blueprint;
  modelOverride?: LLMConfig;
}

/**
 * Inject event request
 */
export interface InjectEventRequest {
  event: BaseEvent;
}

/**
 * Fork state request
 */
export interface ForkStateRequest {
  stateId: string;
}

/**
 * Edit chunk request
 */
export interface EditChunkRequest {
  stateId: string;
  content: ChunkContent;
}

/**
 * Batch test configuration
 */
export interface BatchTestConfig {
  blueprintId: string;
  concurrency: number;
  inputEvent: BaseEvent;
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
  status: 'success' | 'error' | 'timeout';
}

/**
 * Batch test result
 */
export interface BatchTestResult {
  id: string;
  status: 'running' | 'completed' | 'failed';
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

/**
 * Step history entry - records each step operation
 */
export interface StepHistoryEntry {
  /** Unique ID for this step */
  id: string;
  /** Step number (sequential) */
  stepNumber: number;
  /** Timestamp when step was executed */
  timestamp: number;
  /** Type of operation performed */
  operationType:
    | 'event'
    | 'compaction'
    | 'truncation'
    | 'llm_response'
    | 'noop';
  /** Event that was processed (if operationType is 'event') */
  processedEvent?: {
    type: string;
    [key: string]: unknown;
  };
  /** Whether LLM response was generated */
  llmResponseGenerated: boolean;
  /** LLM response content (if any) */
  llmResponse?: string;
  /** Whether execution was cancelled */
  cancelled?: boolean;
  /** State ID before step */
  stateIdBefore: string;
  /** State ID after step */
  stateIdAfter: string;
  /** Whether step resulted in termination */
  shouldTerminate?: boolean;
  /** Whether step triggered an interrupt */
  shouldInterrupt?: boolean;
  /** Error if step failed */
  error?: string;
}

/**
 * SSE event types
 */
export type SSEEventType =
  | 'state:change'
  | 'event:dispatch'
  | 'reducer:execute'
  | 'agent:thinking'
  | 'agent:response'
  | 'agent:error'
  | 'agent:mode_changed'
  | 'agent:stepped'
  | 'agent:terminated'
  | 'subagent:spawn'
  | 'subagent:step'
  | 'subagent:result'
  | 'compaction:start'
  | 'compaction:end'
  | 'error';

/**
 * SSE message
 */
export interface SSEMessage {
  type: SSEEventType;
  data: unknown;
  timestamp: number;
}
