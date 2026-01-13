/**
 * Component-Aware Context Builder
 * Builds LLM context using component-based rendering system
 *
 * Uses ComponentRenderer for fragment assembly, then adds:
 * - Token counting
 * - Token limit enforcement
 * - Message construction
 */

import type { MemoryState } from '../types/state.types.js';
import type { ITokenizer } from '../tokenizer/tokenizer.types.js';
import type {
  ContextBuildOptions,
  ContextBuildResult,
  ContextMessage,
} from './context.types.js';
import type {
  IComponent,
  RenderedFragment,
  ComponentRuntimeState,
} from '../components/component.interface.js';
import { ComponentRenderer } from '../components/component-renderer.js';

/**
 * Extended options for component-aware context building
 */
export interface ComponentContextBuildOptions extends ContextBuildOptions {
  /** Thread ID for component context */
  threadId: string;
  /** Enabled components for this context */
  components: IComponent[];
  /** Optional runtime states for components (for ComponentContext creation) */
  componentRuntimeStates?: Map<string, ComponentRuntimeState>;
}

/**
 * Extended result with component metadata
 */
export interface ComponentContextBuildResult extends ContextBuildResult {
  /** Component keys that contributed to the context */
  componentKeys: string[];
  /** System prompt fragments (sorted by order) */
  systemFragments: RenderedFragment[];
  /** Flow fragments (sorted by order) */
  flowFragments: RenderedFragment[];
}

/**
 * Component-Aware Context Builder
 * Uses ComponentRenderer for fragment assembly, adds token management
 */
export class ComponentContextBuilder {
  private defaultTokenizer?: ITokenizer;
  private renderer: ComponentRenderer;

  constructor(defaultTokenizer?: ITokenizer) {
    this.defaultTokenizer = defaultTokenizer;
    this.renderer = new ComponentRenderer();
  }

  /**
   * Set the default tokenizer
   */
  setDefaultTokenizer(tokenizer: ITokenizer): void {
    this.defaultTokenizer = tokenizer;
  }

  /**
   * Build context from memory state using component-based rendering
   */
  build(
    state: MemoryState,
    options: ComponentContextBuildOptions,
  ): ComponentContextBuildResult {
    const {
      threadId,
      components,
      componentRuntimeStates,
      maxTokens,
      tokenizer = this.defaultTokenizer,
      systemPrompt,
      excludeTypes = [],
      includeOnlyChunkIds,
    } = options;

    // Use ComponentRenderer for fragment assembly
    const renderResult = this.renderer.render(state, {
      threadId,
      components,
      componentRuntimeStates,
      excludeTypes,
      includeOnlyChunkIds,
    });

    // Build messages with token management
    const messages: ContextMessage[] = [];
    const includedChunkIds: string[] = [];
    const excludedChunkIds: string[] = [];
    let tokenCount = 0;
    const tokenCountExact = !!tokenizer;

    // Helper function to count tokens
    const countTokens = (text: string): number => {
      if (tokenizer) {
        return tokenizer.countTokens(text);
      }
      // Fallback: ~4 characters per token
      return Math.ceil(text.length / 4);
    };

    // Build system message from system prompt + system fragments
    const systemParts: string[] = [];
    if (systemPrompt) {
      systemParts.push(systemPrompt);
    }
    if (renderResult.systemContent) {
      systemParts.push(renderResult.systemContent);
    }

    if (systemParts.length > 0) {
      const systemContent = systemParts.join('\n\n');
      const systemTokens = countTokens(systemContent);

      if (!maxTokens || tokenCount + systemTokens <= maxTokens) {
        messages.push({
          role: 'system',
          content: systemContent,
        });
        tokenCount += systemTokens;

        // Track included chunks from system fragments
        for (const chunkId of renderResult.renderedChunkIds) {
          const chunk = state.chunks.get(chunkId);
          if (chunk) {
            // Check if this chunk contributed to system fragments
            const isSystemChunk = renderResult.systemFragments.length > 0;
            if (isSystemChunk) {
              includedChunkIds.push(chunkId);
            }
          }
        }
      }
    }

    // Build flow messages
    for (const msg of renderResult.flowMessages) {
      const msgTokens = countTokens(msg.content);

      if (maxTokens && tokenCount + msgTokens > maxTokens) {
        // Exclude remaining chunks
        for (const chunkId of msg.chunkIds) {
          excludedChunkIds.push(chunkId);
        }
        continue;
      }

      messages.push({
        role: msg.role,
        content: msg.content,
      });
      tokenCount += msgTokens;
      includedChunkIds.push(...msg.chunkIds);
    }

    return {
      messages,
      tokenCount,
      tokenCountExact,
      includedChunkIds,
      excludedChunkIds,
      componentKeys: renderResult.contributingComponentKeys,
      systemFragments: renderResult.systemFragments,
      flowFragments: renderResult.flowFragments,
    };
  }
}

/**
 * Create a new component-aware context builder
 */
export function createComponentContextBuilder(
  tokenizer?: ITokenizer,
): ComponentContextBuilder {
  return new ComponentContextBuilder(tokenizer);
}
