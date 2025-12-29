import type { MemoryState } from '../types/state.types.js';
import type { MemoryChunk } from '../types/chunk.types.js';
import type { Operation } from '../types/operation.types.js';
import type { AgentEvent } from '../types/event.types.js';
import type { ReducerResult } from '../reducer/reducer.types.js';
import type { QueuedEvent } from '../types/thread.types.js';

/**
 * Observer interface for monitoring memory manager events
 */
export interface MemoryObserver {
  /**
   * Called when an event is dispatched
   */
  onEventDispatch?: (event: EventDispatchInfo) => void;

  /**
   * Called when a reducer is executed
   */
  onReducerExecute?: (event: ReducerExecuteInfo) => void;

  /**
   * Called when state changes
   */
  onStateChange?: (event: StateChangeInfo) => void;

  /**
   * Called when a sub-agent is spawned
   */
  onSubAgentSpawn?: (event: SubAgentSpawnInfo) => void;

  /**
   * Called when a sub-agent returns result
   */
  onSubAgentResult?: (event: SubAgentResultInfo) => void;

  /**
   * Called when compaction starts
   */
  onCompactionStart?: (event: CompactionStartInfo) => void;

  /**
   * Called when compaction ends
   */
  onCompactionEnd?: (event: CompactionEndInfo) => void;

  /**
   * Called when an error occurs
   */
  onError?: (event: ErrorInfo) => void;

  /**
   * Called when an event is pushed to the queue
   */
  onEventQueued?: (event: EventQueuedInfo) => void;

  /**
   * Called when an event is popped from the queue
   */
  onEventDequeued?: (event: EventDequeuedInfo) => void;
}

/**
 * Information about an event dispatch
 */
export interface EventDispatchInfo {
  threadId: string;
  event: AgentEvent;
  timestamp: number;
}

/**
 * Information about reducer execution
 */
export interface ReducerExecuteInfo {
  threadId: string;
  reducerName: string;
  inputEvent: AgentEvent;
  inputState: MemoryState;
  result: ReducerResult;
  logs: string[];
  duration: number;
}

/**
 * Information about state change
 */
export interface StateChangeInfo {
  threadId: string;
  previousState: MemoryState;
  newState: MemoryState;
  /** The event that triggered this state change, or null for system operations like truncation */
  triggerEvent: AgentEvent | null;
  reducerName: string;
  operations: Operation[];
  addedChunks: MemoryChunk[];
  removedChunkIds: string[];
}

/**
 * Information about sub-agent spawn
 */
export interface SubAgentSpawnInfo {
  parentThreadId: string;
  subAgentId: string;
  agentType: string;
  task: string;
  timestamp: number;
}

/**
 * Information about sub-agent result
 */
export interface SubAgentResultInfo {
  parentThreadId: string;
  subAgentId: string;
  result: unknown;
  success: boolean;
  timestamp: number;
}

/**
 * Information about compaction start
 */
export interface CompactionStartInfo {
  threadId: string;
  chunkCount: number;
  chunkIds: string[];
  timestamp: number;
}

/**
 * Information about compaction end
 */
export interface CompactionEndInfo {
  threadId: string;
  tokensBefore: number;
  tokensAfter: number;
  compactedChunkId: string;
  originalChunkIds: string[];
  timestamp: number;
}

/**
 * Information about an error
 */
export interface ErrorInfo {
  threadId?: string;
  error: Error;
  context?: string;
  timestamp: number;
}

/**
 * Information about an event being queued
 */
export interface EventQueuedInfo {
  threadId: string;
  queuedEvent: QueuedEvent;
  queueLength: number;
  timestamp: number;
}

/**
 * Information about an event being dequeued
 */
export interface EventDequeuedInfo {
  threadId: string;
  queuedEvent: QueuedEvent;
  queueLength: number;
  timestamp: number;
}

/**
 * Observer manager for handling multiple observers
 */
export interface ObserverManager {
  /**
   * Add an observer
   * @returns Unsubscribe function
   */
  addObserver(observer: MemoryObserver): () => void;

  /**
   * Remove an observer
   */
  removeObserver(observer: MemoryObserver): void;

  /**
   * Notify all observers of an event dispatch
   */
  notifyEventDispatch(info: EventDispatchInfo): void;

  /**
   * Notify all observers of reducer execution
   */
  notifyReducerExecute(info: ReducerExecuteInfo): void;

  /**
   * Notify all observers of state change
   */
  notifyStateChange(info: StateChangeInfo): void;

  /**
   * Notify all observers of sub-agent spawn
   */
  notifySubAgentSpawn(info: SubAgentSpawnInfo): void;

  /**
   * Notify all observers of sub-agent result
   */
  notifySubAgentResult(info: SubAgentResultInfo): void;

  /**
   * Notify all observers of compaction start
   */
  notifyCompactionStart(info: CompactionStartInfo): void;

  /**
   * Notify all observers of compaction end
   */
  notifyCompactionEnd(info: CompactionEndInfo): void;

  /**
   * Notify all observers of an error
   */
  notifyError(info: ErrorInfo): void;

  /**
   * Notify all observers of an event being queued
   */
  notifyEventQueued(info: EventQueuedInfo): void;

  /**
   * Notify all observers of an event being dequeued
   */
  notifyEventDequeued(info: EventDequeuedInfo): void;
}
