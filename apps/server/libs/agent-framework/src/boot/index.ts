/**
 * Boot Layer - User-friendly API for agent-framework
 *
 * This module provides a simplified entry point for creating and managing agents.
 */

// Main classes
export { AgentFactory } from './AgentFactory.js';
export { Agent } from './Agent.js';

// Types
export type { AgentFactoryConfig, CreateAgentOptions } from './types.js';

// Re-export commonly used types
export type {
  ExecutionMode,
  Blueprint,
  MemoryState,
  MemoryThread,
  MemoryChunk,
  AgentEvent,
  MemoryObserver,
  Tool,
  DispatchResult,
  StepResult,
  Step,
  QueuedEvent,
  IComponent,
} from './types.js';
