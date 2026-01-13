/**
 * IMemoryManager Interface
 *
 * Pure data layer interface for managing Thread, State, Step, and Event Queue.
 *
 * @module manager/memory-manager.interface
 */

import type { MemoryState } from '../types/state.types.js';
import type { MemoryThread, QueuedEvent } from '../types/thread.types.js';
import type { MemoryChunk } from '../types/chunk.types.js';
import type { BaseEvent, EventType } from '../types/event.types.js';
import type { StorageProvider } from '../storage/storage.types.js';
import type { LLMConfig } from '../llm/llm.types.js';
import type {
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
} from '../llm/llm.types.js';
import type { Blueprint } from '../blueprint/blueprint.types.js';

// ============ Thread Creation Types ============

/**
 * Options for creating a new thread
 */
export interface CreateThreadOptions {
  /** Initial chunks to include in the thread */
  initialChunks?: MemoryChunk[];
  /** Custom user-defined metadata for the thread */
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

/**
 * Result of creating a thread
 */
export interface CreateThreadResult {
  /** The created thread */
  thread: Readonly<MemoryThread>;
  /** The initial state of the thread */
  initialState: Readonly<MemoryState>;
}

// ============ Step Types ============

/**
 * Step status
 */
export type StepStatus = 'running' | 'completed' | 'failed';

/**
 * LLM interaction record for debugging
 */
export interface LLMInteraction {
  startedAt: number;
  completedAt?: number;
  duration?: number;
  request: {
    messages: LLMMessage[];
    tools?: LLMToolDefinition[];
    temperature?: number;
    maxTokens?: number;
  };
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
  error?: string;
}

/**
 * Step record - tracks a single event processing step
 */
export interface Step {
  id: string;
  threadId: string;
  triggerEvent: {
    eventId?: string;
    type: EventType | string;
    timestamp: number;
  };
  eventPayload?: BaseEvent;
  llmInteraction?: LLMInteraction;
  status: StepStatus;
  startedAt: number;
  completedAt?: number;
  duration?: number;
  previousStateId?: string;
  resultStateId?: string;
  error?: string;
  context?: Record<string, unknown>;
}

// ============ Event Queue Interface ============

/**
 * Event Queue interface for a specific thread
 */
export interface IEventQueue {
  push(event: QueuedEvent): Promise<void>;
  pushMany(events: QueuedEvent[]): Promise<void>;
  pop(): Promise<QueuedEvent | null>;
  peek(): Promise<QueuedEvent | null>;
  getAll(): Promise<QueuedEvent[]>;
  clear(): Promise<void>;
  length(): Promise<number>;
}

// ============ IMemoryManager Interface ============

/**
 * Memory Manager Interface - Pure Data Layer
 *
 * Responsibilities:
 * - Thread lifecycle management (create, get, delete)
 * - State retrieval (with caching)
 * - Step recording
 * - Event queue access
 * - Parent-child thread relationships
 *
 * Does NOT handle:
 * - Operation execution (handled by AgentOrchestrator)
 * - Event dispatching logic
 * - Reducer execution
 * - Execution mode control
 * - Step locking (runtime coordination)
 *
 * Note: For direct storage operations (saveState, saveChunks, etc.),
 * use getStorage() to access the underlying StorageProvider.
 */
export interface IMemoryManager {
  // Thread
  createThread(options?: CreateThreadOptions): Promise<CreateThreadResult>;
  getThread(threadId: string): Promise<Readonly<MemoryThread> | null>;
  deleteThread(threadId: string): Promise<void>;

  // State (read operations with caching)
  getCurrentState(threadId: string): Promise<Readonly<MemoryState> | null>;
  getState(stateId: string): Promise<Readonly<MemoryState> | null>;
  getInitialState(threadId: string): Promise<Readonly<MemoryState> | null>;
  getStateHistory(threadId: string): Promise<Readonly<MemoryState>[]>;

  // Step (recordStep generates id internally and returns it)
  recordStep(step: Omit<Step, 'id'>): Promise<string>;
  getStep(stepId: string): Promise<Step | null>;
  getStepsByThread(threadId: string): Promise<Step[]>;
  updateStep(stepId: string, updates: Partial<Omit<Step, 'id'>>): Promise<void>;

  // Event Queue
  getEventQueue(threadId: string): IEventQueue;

  // Parent-Child Thread Relationships
  addChildThread(parentThreadId: string, childThreadId: string): Promise<void>;
  getChildThreads(parentThreadId: string): Promise<Readonly<MemoryThread>[]>;
  getParentThread(
    childThreadId: string,
  ): Promise<Readonly<MemoryThread> | null>;
  removeChildThread(
    parentThreadId: string,
    childThreadId: string,
  ): Promise<void>;

  // Cache Management
  updateStateCache(threadId: string, state: Readonly<MemoryState>): void;
  clearStateCache(threadId: string): void;

  // Storage (for direct access to underlying storage operations)
  getStorage(): StorageProvider;
}
