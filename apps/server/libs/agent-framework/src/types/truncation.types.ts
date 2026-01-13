/**
 * Truncation Types
 *
 * Types for non-destructive, component-level truncation of memory state.
 * Truncation creates a temporary minimal state view for LLM execution
 * without modifying the original state.
 */

import type { MemoryState } from './state.types.js';
import type { MemoryChunk } from './chunk.types.js';
import type { ITokenizer } from '../tokenizer/tokenizer.types.js';
import type { IComponent } from '../components/component.interface.js';

// ============ Truncation Context ============

/**
 * Context for truncation operations
 * Minimal - just the state, component uses its own utility functions
 */
export interface TruncationContext {
  /** Current memory state */
  state: MemoryState;
}

// ============ Truncation Results ============

/**
 * Result of minifyTruncate operation
 */
export interface TruncationResult {
  /** Truncated chunks (temporary, not persisted) */
  truncatedChunks: MemoryChunk[];
  /** Estimated tokens reduced */
  tokensReduced: number;
}

/**
 * Result of stepTruncate operation
 */
export interface TruncationStepResult extends TruncationResult {
  /** Whether more steps are possible */
  canContinue: boolean;
}

// ============ Truncation Options ============

/**
 * Options for truncation
 */
export interface TruncationOptions {
  /** Target maximum tokens (specific token count, not percentage) */
  maxTokenTarget: number;
  /** Optional tokenizer for accurate counting */
  tokenizer?: ITokenizer;
}

/**
 * Configuration for truncation thresholds
 * Used by TurnExecutor to configure truncation behavior
 */
export interface TruncationConfig {
  /** Token limit for proactive truncation (before LLM call) */
  proactiveLimit?: number;
  /** Token limit for reactive truncation (on LLM error) */
  reactiveLimit?: number;
}

/**
 * Result of truncate operation
 */
export interface TruncatedStateResult {
  /** Temporary truncated state (DO NOT persist) */
  truncatedState: MemoryState;
  /** Original state (unchanged) */
  originalState: MemoryState;
  /** Whether truncation was needed */
  wasTruncated: boolean;
  /** Tokens in original state */
  originalTokens: number;
  /** Tokens in truncated state */
  truncatedTokens: number;
}

// ============ Truncatable Component Interface ============

/**
 * Interface for components that support truncation
 * Components can optionally implement this interface to support context reduction
 */
export interface ITruncatableComponent {
  /**
   * Return the minimum/simplest version of this component's content
   * Called first during truncation to get the most reduced form
   * @param context - Truncation context with current state
   * @returns Truncated chunks or null if not supported
   */
  minifyTruncate(context: TruncationContext): Promise<TruncationResult | null>;

  /**
   * Discard one piece of content from this component
   * Called iteratively when more reduction is needed
   * @param context - Truncation context with current state
   * @returns Truncated chunks and token reduction estimate, or null if nothing more to discard
   */
  stepTruncate(
    context: TruncationContext,
  ): Promise<TruncationStepResult | null>;

  /**
   * Get weight for truncation priority (lower = discard first)
   * Weight can depend on current state (e.g., how critical the content is)
   * @param context - Truncation context with current state
   * @returns Weight number (default: 100)
   */
  getTruncationWeight(context: TruncationContext): number;
}

/**
 * Type guard to check if a component supports truncation
 */
export function isTruncatable(
  component: IComponent,
): component is IComponent & ITruncatableComponent {
  return (
    'minifyTruncate' in component &&
    'stepTruncate' in component &&
    'getTruncationWeight' in component &&
    typeof (component as ITruncatableComponent).minifyTruncate === 'function' &&
    typeof (component as ITruncatableComponent).stepTruncate === 'function' &&
    typeof (component as ITruncatableComponent).getTruncationWeight ===
      'function'
  );
}
