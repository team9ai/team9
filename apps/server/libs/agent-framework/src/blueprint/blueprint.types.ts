import { ChunkContent } from '../types/chunk.types';
import { LLMConfig } from '../llm/llm.types';

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
  /** Initial chunks to populate the agent's memory */
  initialChunks: BlueprintChunk[];
  /** LLM configuration */
  llmConfig: LLMConfig;
  /** Available tools */
  tools?: string[];
  /** Auto-compaction threshold (number of compressible chunks) */
  autoCompactThreshold?: number;
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
