import { ChunkContent } from '../types/chunk.types.js';
import { LLMConfig } from '../llm/llm.types.js';
import type { ComponentConfig } from '../components/component.types.js';

/**
 * Execution mode for agent event processing
 * - 'auto': Events are processed immediately when dispatched
 * - 'stepping': Events are queued until explicitly triggered via step()
 *
 * Use 'stepping' mode for:
 * - Debugging: observe state changes step by step
 * - Batch generation: prevent runaway execution, maintain control
 */
export type ExecutionMode = 'auto' | 'stepping';

/**
 * Blueprint definition for creating agents
 * Blueprints define the initial configuration and structure of an agent
 */
export interface Blueprint {
  /** Optional unique identifier */
  id?: string;
  /** Agent name */
  name: string;
  /** Agent description */
  description?: string;
  /**
   * Components that define the agent's structure
   * Each component can include instructions and tools
   * Components are rendered to chunks and tools at runtime
   */
  components?: ComponentConfig[];
  /**
   * Initial chunks to populate the agent's memory
   * @deprecated Use components instead for better organization
   */
  initialChunks?: BlueprintChunk[];
  /** LLM configuration */
  llmConfig: LLMConfig;
  /**
   * Available control tools (names only)
   * For custom tools, define them in components
   */
  tools?: string[];
  /** Auto-compaction threshold (number of compressible chunks) */
  autoCompactThreshold?: number;
  /**
   * Execution mode for event processing (default: 'auto')
   * - 'auto': Events are processed immediately
   * - 'stepping': Events are queued until step() is called
   */
  executionMode?: ExecutionMode;
  /** Nested sub-agent blueprints */
  subAgents?: Record<string, Blueprint>;
}

/**
 * Chunk definition in blueprint (simplified for JSON serialization)
 */
export interface BlueprintChunk {
  /** Chunk type (SYSTEM, AGENT, WORKFLOW, etc.) */
  type: string;
  /** Working flow subtype (only for WORKING_FLOW type) */
  subType?: string;
  /** Chunk content */
  content: ChunkContent;
  /** Retention strategy (CRITICAL, COMPRESSIBLE, etc.) */
  retentionStrategy?: string;
  /** Whether this chunk can be modified */
  mutable?: boolean;
  /** Priority (higher = more important) */
  priority?: number;
}

/**
 * Options for loading a blueprint
 */
export interface BlueprintLoadOptions {
  /** Override LLM configuration */
  llmConfigOverride?: Partial<LLMConfig>;
  /** Override auto-compaction threshold */
  autoCompactThresholdOverride?: number;
}

/**
 * Result of loading a blueprint
 */
export interface BlueprintLoadResult {
  /** The loaded blueprint with applied overrides */
  blueprint: Blueprint;
  /** Validation warnings (non-fatal issues) */
  warnings: string[];
}

/**
 * Blueprint validation result
 */
export interface BlueprintValidationResult {
  /** Whether the blueprint is valid */
  valid: boolean;
  /** Validation errors */
  errors: string[];
  /** Validation warnings */
  warnings: string[];
}
