import { LLMConfig } from '../llm/llm.types.js';

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
   * Each component entry contains a component key and its configuration
   * Components are rendered to chunks and tools at runtime
   */
  components?: BlueprintComponentEntry[];
  /** LLM configuration */
  llmConfig: LLMConfig;
  /**
   * Available control tools (names only)
   * For custom tools, define them in components
   */
  tools?: string[];
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
 * Options for loading a blueprint
 */
export interface BlueprintLoadOptions {
  /** Override LLM configuration */
  llmConfigOverride?: Partial<LLMConfig>;
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

// ============ Component-Centric Configuration ============

/**
 * Component configuration entry for Blueprint
 * Uses component key (string) to reference registered components
 */
export interface BlueprintComponentEntry<TConfig = Record<string, unknown>> {
  /** Component key to look up in ComponentManager */
  componentKey: string;
  /** Configuration to pass to component constructor */
  config?: TConfig;
  /** Whether to enable this component initially (default: true) */
  enabled?: boolean;
}

// ============ Zod Schemas for Validation ============

import { z } from 'zod';

/**
 * Zod schema for LLMConfig
 */
export const LLMConfigSchema = z.object({
  model: z.string().min(1, 'LLM model is required'),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
});

/**
 * Zod schema for ExecutionMode
 */
export const ExecutionModeSchema = z.enum(['auto', 'stepping']);

/**
 * Zod schema for BlueprintComponentEntry
 * Uses componentKey (string) to reference registered components
 */
export const BlueprintComponentEntrySchema = z.object({
  componentKey: z.string().min(1, 'Component key is required'),
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

/**
 * Zod schema for Blueprint (recursive)
 */
export const BlueprintSchema: z.ZodType<Blueprint> = z.lazy(() =>
  z.object({
    id: z.string().optional(),
    name: z.string().min(1, 'Blueprint name is required'),
    description: z.string().optional(),
    components: z.array(BlueprintComponentEntrySchema).optional(),
    llmConfig: LLMConfigSchema,
    tools: z.array(z.string()).optional(),
    executionMode: ExecutionModeSchema.optional(),
    subAgents: z.record(z.string(), BlueprintSchema).optional(),
  }),
) as z.ZodType<Blueprint>;

/**
 * Zod schema for BlueprintLoadOptions
 */
export const BlueprintLoadOptionsSchema = z.object({
  llmConfigOverride: LLMConfigSchema.partial().optional(),
});
