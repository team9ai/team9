import type {
  AgentEvent,
  MemoryState,
  MemoryChunk,
  ChunkContent,
  LLMConfig,
} from '@team9/agent-framework';

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
  llmConfig: LLMConfig;
  modelOverride?: LLMConfig;
  createdAt: number;
  updatedAt: number;
  parentAgentId?: string;
  subAgentIds: string[];
}

export type AgentStatus = 'running' | 'paused' | 'completed' | 'error';

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
  event: AgentEvent;
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
  inputEvent: AgentEvent;
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
 * SSE event types
 */
export type SSEEventType =
  | 'state:change'
  | 'event:dispatch'
  | 'reducer:execute'
  | 'agent:paused'
  | 'agent:resumed'
  | 'agent:thinking'
  | 'agent:response'
  | 'agent:error'
  | 'subagent:spawn'
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
