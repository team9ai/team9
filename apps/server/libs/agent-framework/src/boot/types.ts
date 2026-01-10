/**
 * Boot Layer Types
 *
 * User-friendly type definitions for the boot API.
 */

import type { StorageProvider } from '../storage/storage.types.js';
import type { ILLMAdapter, LLMConfig } from '../llm/llm.types.js';
import type { TokenThresholds } from '../manager/compaction.manager.js';
import type { ExecutionMode } from '../blueprint/blueprint.types.js';
import type { ComponentConstructor } from '../components/component.interface.js';
import type { Tool } from '../tools/tool.types.js';

// Re-export commonly used types for convenience
export type { ExecutionMode } from '../blueprint/blueprint.types.js';
export type { Blueprint } from '../blueprint/blueprint.types.js';
export type { MemoryState } from '../types/state.types.js';
export type { MemoryThread, QueuedEvent } from '../types/thread.types.js';
export type { MemoryChunk } from '../types/chunk.types.js';
export type { AgentEvent } from '../types/event.types.js';
export type { MemoryObserver } from '../observer/observer.types.js';
export type { Tool } from '../tools/tool.types.js';
export type { DispatchResult } from '../manager/event-processor.js';
export type { StepResult } from '../manager/execution-mode.controller.js';
export type { Step } from '../manager/memory-manager.interface.js';
export type {
  EventReducer,
  ReducerRegistry,
} from '../reducer/reducer.types.js';
export type {
  IComponentRegistry,
  ComponentRegistry,
} from '../components/component-registry.js';
export type { ComponentConstructor } from '../components/component.interface.js';
export type { IComponent } from '../components/component.interface.js';

/**
 * Configuration for AgentFactory
 */
export interface AgentFactoryConfig {
  /** Storage provider for persistence */
  storage: StorageProvider;
  /** LLM adapter for AI interactions */
  llmAdapter: ILLMAdapter;
  /** Default LLM configuration (required for compaction) */
  defaultLLMConfig: LLMConfig;
  /** Whether to enable auto-compaction (default: true) */
  autoCompactEnabled?: boolean;
  /** Token-based threshold configuration */
  tokenThresholds?: Partial<TokenThresholds>;
  /** Default execution mode for new threads (default: 'auto') */
  defaultExecutionMode?: ExecutionMode;
  /** Components to register on initialization */
  components?: ComponentConstructor[];
  /** Tools to register on initialization */
  tools?: Tool[];
}

/**
 * Options for creating an agent from a blueprint
 */
export interface CreateAgentOptions {
  /** Override blueprint LLM configuration */
  llmConfigOverride?: Partial<LLMConfig>;
  /** Override execution mode for this agent */
  executionMode?: ExecutionMode;
}
