/**
 * Truncation Manager
 *
 * Provides non-destructive truncation of memory state for LLM context limits.
 * Creates temporary state views without modifying the original state.
 *
 * Key principles:
 * 1. Non-destructive: Original state is never modified
 * 2. Temporary: Truncated state is only used for LLM call
 * 3. Component-aware: Each component controls its own truncation logic
 * 4. Progressive: First minify, then step truncate by efficiency
 * 5. Weight-based: Lower weight = discard first
 *
 * Note: Token counting is NOT handled here. Components report tokensReduced,
 * and external code (TurnExecutor) handles token estimation.
 */

import type { MemoryState } from '../types/state.types.js';
import type { MemoryChunk } from '../types/chunk.types.js';
import type { IComponent } from '../components/component.interface.js';
import type {
  TruncationContext,
  TruncationOptions,
  TruncationResult,
  TruncatedStateResult,
  ITruncatableComponent,
} from '../types/truncation.types.js';
import { isTruncatable } from '../types/truncation.types.js';
import { cloneState } from '../factories/state.factory.js';

// ============ Truncation Result Application ============

/**
 * Apply truncation result to state
 * Updates chunks in the state with truncated versions
 */
function applyTruncationResult(
  state: MemoryState,
  result: TruncationResult,
): void {
  // Cast to mutable map for modification
  const mutableChunks = state.chunks as Map<string, MemoryChunk>;

  for (const truncatedChunk of result.truncatedChunks) {
    // Update existing chunk with truncated version
    if (mutableChunks.has(truncatedChunk.id)) {
      mutableChunks.set(truncatedChunk.id, truncatedChunk);
    }
  }
}

// ============ Main Truncation Algorithm ============

/**
 * Create a temporary truncated state view for LLM
 * DOES NOT modify the original state
 *
 * Algorithm:
 * 1. Clone state for modification
 * 2. Phase 1: Run minifyTruncate on all truncatable components
 * 3. Phase 2: Iterative stepTruncate until tokensReduced reaches target
 *    - Calculate efficiency for each component: tokensReduced / weight
 *    - Execute highest efficiency candidate
 *    - Repeat until target reached or no more truncation possible
 *
 * Note: This function tracks cumulative tokensReduced reported by components.
 * It does NOT independently count tokens - that's the responsibility of
 * external code (TurnExecutor) which provides maxTokenTarget.
 *
 * @param state - Original memory state (not modified)
 * @param components - All components (will filter to truncatable)
 * @param options - Truncation options including maxTokenTarget
 * @returns Truncated state result
 */
export async function truncate(
  state: MemoryState,
  components: IComponent[],
  options: TruncationOptions,
): Promise<TruncatedStateResult> {
  const { maxTokenTarget } = options;

  // Clone state for modification
  const truncatedState = cloneState(state);
  let totalTokensReduced = 0;

  // Build TruncationContext
  const buildContext = (): TruncationContext => ({
    state: truncatedState,
  });

  // Filter to only truncatable components
  const truncatableComponents = components.filter(isTruncatable) as Array<
    IComponent & ITruncatableComponent
  >;

  console.log(
    `[TruncationManager] Starting truncation with ${truncatableComponents.length} truncatable components, target reduction: ${maxTokenTarget} tokens`,
  );

  if (truncatableComponents.length === 0) {
    // No truncatable components, return original state
    return {
      truncatedState: state,
      originalState: state,
      wasTruncated: false,
      originalTokens: 0, // Not tracked here
      truncatedTokens: 0, // Not tracked here
    };
  }

  // Phase 1: Run minifyTruncate on all truncatable components
  for (const component of truncatableComponents) {
    const ctx = buildContext();
    const result = await component.minifyTruncate(ctx);

    if (result && result.tokensReduced > 0) {
      applyTruncationResult(truncatedState, result);
      totalTokensReduced += result.tokensReduced;

      console.log(
        `[TruncationManager] minifyTruncate ${component.id}: reduced ${result.tokensReduced} tokens, total reduced: ${totalTokensReduced}`,
      );

      if (totalTokensReduced >= maxTokenTarget) {
        break;
      }
    }
  }

  // Phase 2: Iterative stepTruncate until target reached
  let iterations = 0;
  const maxIterations = 100; // Safety limit

  while (totalTokensReduced < maxTokenTarget && iterations < maxIterations) {
    iterations++;
    const ctx = buildContext(); // Rebuild after each modification

    // Calculate efficiency for each component: tokensReduced / weight
    const candidates = await Promise.all(
      truncatableComponents.map(async (c) => {
        const preview = await c.stepTruncate(ctx);
        if (!preview || preview.tokensReduced <= 0) return null;

        // Get dynamic weight from component
        const weight = c.getTruncationWeight(ctx);
        // Efficiency: higher = better candidate to truncate
        // Higher tokensReduced and lower weight both increase efficiency
        const efficiency = preview.tokensReduced / weight;
        return { component: c, preview, efficiency };
      }),
    );

    const validCandidates = candidates
      .filter(
        (
          c,
        ): c is {
          component: IComponent & ITruncatableComponent;
          preview: TruncationResult & { canContinue: boolean };
          efficiency: number;
        } => c !== null,
      )
      .sort((a, b) => b.efficiency - a.efficiency); // Highest efficiency first

    if (validCandidates.length === 0) {
      console.log(
        `[TruncationManager] No more truncation possible, total reduced: ${totalTokensReduced}`,
      );
      break; // No more truncation possible
    }

    // Execute best candidate
    const best = validCandidates[0];
    applyTruncationResult(truncatedState, best.preview);
    totalTokensReduced += best.preview.tokensReduced;

    console.log(
      `[TruncationManager] stepTruncate ${best.component.id}: reduced ${best.preview.tokensReduced} tokens (efficiency: ${best.efficiency.toFixed(2)}), total reduced: ${totalTokensReduced}`,
    );
  }

  console.log(
    `[TruncationManager] Truncation complete: reduced ${totalTokensReduced} tokens in ${iterations} iterations`,
  );

  return {
    truncatedState,
    originalState: state,
    wasTruncated: totalTokensReduced > 0,
    originalTokens: 0, // Not tracked here
    truncatedTokens: 0, // Not tracked here
  };
}

/**
 * TruncationManager class for dependency injection patterns
 */
export class TruncationManager {
  /**
   * Truncate state to reduce tokens
   */
  async truncate(
    state: MemoryState,
    components: IComponent[],
    options: TruncationOptions,
  ): Promise<TruncatedStateResult> {
    return truncate(state, components, options);
  }
}

/**
 * Create a new TruncationManager instance
 */
export function createTruncationManager(): TruncationManager {
  return new TruncationManager();
}
