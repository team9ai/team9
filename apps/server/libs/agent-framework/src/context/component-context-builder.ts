/**
 * Component-Aware Context Builder
 * Builds LLM context using component-based rendering system
 *
 * Architecture:
 * 1. Groups chunks by componentId
 * 2. Gets RenderConfig from each component for its chunks
 * 3. Sorts fragments by location -> order
 * 4. Calls component.renderChunk() for rendering
 */

import type { MemoryChunk, ChunkType } from '../types/chunk.types.js';
import type { MemoryState } from '../types/state.types.js';
import type { ITokenizer } from '../tokenizer/tokenizer.types.js';
import type {
  ContextBuildOptions,
  ContextBuildResult,
  ContextMessage,
  ContextMessageRole,
} from './context.types.js';
import type {
  IComponent,
  RenderedFragment,
  ComponentContext,
} from '../components/component.interface.js';
import type { ComponentManager } from '../components/component-manager.js';

/**
 * Extended options for component-aware context building
 */
export interface ComponentContextBuildOptions extends ContextBuildOptions {
  /** Thread ID for component context */
  threadId: string;
}

/**
 * Extended result with component metadata
 */
export interface ComponentContextBuildResult extends ContextBuildResult {
  /** Components that contributed to the context */
  componentIds: string[];
  /** System prompt fragments (sorted by order) */
  systemFragments: RenderedFragment[];
  /** Flow fragments (sorted by order) */
  flowFragments: RenderedFragment[];
}

/**
 * Component-Aware Context Builder
 * Uses ComponentManager and IComponent.renderChunk() for rendering
 */
export class ComponentContextBuilder {
  private componentManager: ComponentManager;
  private defaultTokenizer?: ITokenizer;

  constructor(
    componentManager: ComponentManager,
    defaultTokenizer?: ITokenizer,
  ) {
    this.componentManager = componentManager;
    this.defaultTokenizer = defaultTokenizer;
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
      maxTokens,
      tokenizer = this.defaultTokenizer,
      systemPrompt,
      excludeTypes = [],
      includeOnlyChunkIds,
    } = options;

    // Get all enabled components for this thread
    const enabledComponents =
      this.componentManager.getEnabledComponents(threadId);
    const componentMap = new Map<string, IComponent>();
    for (const component of enabledComponents) {
      componentMap.set(component.id, component);
    }

    // Collect all fragments from all components
    const allFragments: Array<{
      fragment: RenderedFragment;
      chunk: MemoryChunk;
      componentId: string;
    }> = [];

    // Process chunks ordered by state.chunkIds
    for (const chunkId of state.chunkIds) {
      const chunk = state.chunks.get(chunkId);
      if (!chunk) continue;

      // Apply filters
      if (includeOnlyChunkIds && !includeOnlyChunkIds.includes(chunkId)) {
        continue;
      }
      if (excludeTypes.includes(chunk.type)) {
        continue;
      }

      // Find the component that owns this chunk
      const componentId = chunk.componentId;
      if (!componentId) {
        // Chunk has no componentId - skip or use fallback rendering
        continue;
      }

      const component = componentMap.get(componentId);
      if (!component) {
        // Component not enabled - skip this chunk
        continue;
      }

      // Get component context
      const context = this.componentManager.getComponentContext(
        threadId,
        componentId,
        state,
      );
      if (!context) continue;

      // Render chunk using component
      const fragments = component.renderChunk(chunk, context);
      for (const fragment of fragments) {
        allFragments.push({
          fragment,
          chunk,
          componentId,
        });
      }
    }

    // Separate fragments by location
    const systemFragments: RenderedFragment[] = [];
    const flowFragments: RenderedFragment[] = [];

    for (const { fragment } of allFragments) {
      if (fragment.location === 'system') {
        systemFragments.push(fragment);
      } else {
        flowFragments.push(fragment);
      }
    }

    // Sort by order (ascending)
    const sortByOrder = (a: RenderedFragment, b: RenderedFragment) =>
      (a.order ?? 500) - (b.order ?? 500);

    systemFragments.sort(sortByOrder);
    flowFragments.sort(sortByOrder);

    // Build messages
    const messages: ContextMessage[] = [];
    const includedChunkIds: string[] = [];
    const excludedChunkIds: string[] = [];
    const contributingComponentIds = new Set<string>();
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
    for (const fragment of systemFragments) {
      systemParts.push(fragment.content);
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
        for (const { fragment, chunk, componentId } of allFragments) {
          if (fragment.location === 'system') {
            includedChunkIds.push(chunk.id);
            contributingComponentIds.add(componentId);
          }
        }
      }
    }

    // Build flow messages (user/assistant alternating)
    // Group flow fragments into messages based on chunk roles
    const flowMessages = this.groupFlowFragments(
      allFragments.filter(({ fragment }) => fragment.location === 'flow'),
      state,
    );

    for (const msg of flowMessages) {
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
      for (const compId of msg.componentIds) {
        contributingComponentIds.add(compId);
      }
    }

    return {
      messages,
      tokenCount,
      tokenCountExact,
      includedChunkIds,
      excludedChunkIds,
      componentIds: Array.from(contributingComponentIds),
      systemFragments,
      flowFragments,
    };
  }

  /**
   * Group flow fragments into messages with appropriate roles
   */
  private groupFlowFragments(
    fragments: Array<{
      fragment: RenderedFragment;
      chunk: MemoryChunk;
      componentId: string;
    }>,
    state: MemoryState,
  ): Array<{
    role: ContextMessageRole;
    content: string;
    chunkIds: string[];
    componentIds: string[];
  }> {
    const messages: Array<{
      role: ContextMessageRole;
      content: string;
      chunkIds: string[];
      componentIds: string[];
    }> = [];

    // Sort fragments by chunk order in state
    const chunkOrderMap = new Map<string, number>();
    state.chunkIds.forEach((id, index) => {
      chunkOrderMap.set(id, index);
    });

    fragments.sort((a, b) => {
      const orderA = chunkOrderMap.get(a.chunk.id) ?? 0;
      const orderB = chunkOrderMap.get(b.chunk.id) ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      // Secondary sort by fragment order
      return (a.fragment.order ?? 500) - (b.fragment.order ?? 500);
    });

    // Group consecutive fragments by role
    for (const { fragment, chunk, componentId } of fragments) {
      const role = this.getChunkRole(chunk);

      if (messages.length > 0 && messages[messages.length - 1].role === role) {
        // Append to existing message
        const lastMsg = messages[messages.length - 1];
        lastMsg.content += '\n\n' + fragment.content;
        if (!lastMsg.chunkIds.includes(chunk.id)) {
          lastMsg.chunkIds.push(chunk.id);
        }
        if (!lastMsg.componentIds.includes(componentId)) {
          lastMsg.componentIds.push(componentId);
        }
      } else {
        // Start new message
        messages.push({
          role,
          content: fragment.content,
          chunkIds: [chunk.id],
          componentIds: [componentId],
        });
      }
    }

    return messages;
  }

  /**
   * Determine the message role for a chunk based on its type and content
   */
  private getChunkRole(chunk: MemoryChunk): ContextMessageRole {
    // User message types
    if (
      chunk.type === 'USER_MESSAGE' ||
      chunk.type === 'PARENT_MESSAGE' ||
      chunk.type === 'ACTION_RESPONSE' ||
      chunk.type === 'SUBAGENT_RESULT' ||
      chunk.type === 'ENVIRONMENT'
    ) {
      return 'user';
    }

    // Assistant message types
    if (
      chunk.type === 'AGENT_RESPONSE' ||
      chunk.type === 'AGENT_ACTION' ||
      chunk.type === 'SUBAGENT_SPAWN' ||
      chunk.type === 'THINKING'
    ) {
      return 'assistant';
    }

    // System types
    if (chunk.type === 'SYSTEM') {
      return 'system';
    }

    // Check content for role hint
    const content = chunk.content as { role?: string };
    if (content.role === 'user') return 'user';
    if (content.role === 'assistant') return 'assistant';
    if (content.role === 'system') return 'system';

    // Default to user for unknown types
    return 'user';
  }
}

/**
 * Create a new component-aware context builder
 */
export function createComponentContextBuilder(
  componentManager: ComponentManager,
  tokenizer?: ITokenizer,
): ComponentContextBuilder {
  return new ComponentContextBuilder(componentManager, tokenizer);
}
