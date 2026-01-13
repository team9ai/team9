/**
 * Component Renderer
 * Responsible for rendering chunks to fragments and assembling them into prompts
 *
 * Architecture:
 * - Takes MemoryState and components
 * - Calls component.renderChunk() to get RenderedFragment[]
 * - Separates fragments by location (system/flow)
 * - Sorts fragments by order
 * - Assembles into system content and flow messages
 */

import type { MemoryChunk } from '../types/chunk.types.js';
import type { MemoryState } from '../types/state.types.js';
import type {
  IComponent,
  RenderedFragment,
  ComponentContext,
  ComponentRuntimeState,
} from './component.interface.js';
import type { ContextMessageRole } from '../context/context.types.js';
import { createComponentContext } from './component-context.js';

/**
 * Options for fragment rendering
 */
export interface FragmentRenderOptions {
  /** Thread ID for component context */
  threadId: string;
  /** Enabled components for this context */
  components: IComponent[];
  /** Optional runtime states for components (for ComponentContext creation) */
  componentRuntimeStates?: Map<string, ComponentRuntimeState>;
  /** Chunk types to exclude */
  excludeTypes?: string[];
  /** Only include specific chunk IDs */
  includeOnlyChunkIds?: string[];
}

/**
 * A flow message with role, content, and metadata
 */
export interface FlowMessage {
  role: ContextMessageRole;
  content: string;
  chunkIds: string[];
  componentKeys: string[];
}

/**
 * Result of fragment rendering
 */
export interface FragmentRenderResult {
  /** System prompt content (assembled from system fragments) */
  systemContent: string;
  /** System fragments (sorted by order, for debugging) */
  systemFragments: RenderedFragment[];
  /** Flow messages (user/assistant conversation) */
  flowMessages: FlowMessage[];
  /** Flow fragments (sorted by order, for debugging) */
  flowFragments: RenderedFragment[];
  /** Component keys that contributed to the render */
  contributingComponentKeys: string[];
  /** All chunk IDs that were rendered */
  renderedChunkIds: string[];
}

/**
 * Internal structure for tracking fragment source
 */
interface FragmentWithSource {
  fragment: RenderedFragment;
  chunk: MemoryChunk;
  componentKey: string;
}

/**
 * Component Renderer
 * Renders chunks to fragments and assembles them into prompts
 */
export class ComponentRenderer {
  /**
   * Render state to system content and flow messages
   */
  render(
    state: MemoryState,
    options: FragmentRenderOptions,
  ): FragmentRenderResult {
    const {
      threadId,
      components,
      componentRuntimeStates,
      excludeTypes = [],
      includeOnlyChunkIds,
    } = options;

    // Build component map for lookup
    const componentMap = new Map<string, IComponent>();
    for (const component of components) {
      componentMap.set(component.id, component);
    }

    // Collect all fragments from all chunks
    const allFragments: FragmentWithSource[] = [];

    // Process chunks in state order
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
      const componentKey = chunk.componentKey;
      if (!componentKey) {
        // Chunk has no componentKey - skip
        continue;
      }

      const component = componentMap.get(componentKey);
      if (!component) {
        // Component not enabled - skip this chunk
        continue;
      }

      // Get or create component context
      const context = this.getOrCreateContext(
        threadId,
        componentKey,
        state,
        componentRuntimeStates,
      );

      // Render chunk using component
      const fragments = component.renderChunk(chunk, context);
      for (const fragment of fragments) {
        allFragments.push({
          fragment,
          chunk,
          componentKey,
        });
      }
    }

    // Separate fragments by location
    const systemFragmentSources: FragmentWithSource[] = [];
    const flowFragmentSources: FragmentWithSource[] = [];

    for (const source of allFragments) {
      if (source.fragment.location === 'system') {
        systemFragmentSources.push(source);
      } else {
        flowFragmentSources.push(source);
      }
    }

    // Sort by order (ascending)
    const sortByOrder = (a: FragmentWithSource, b: FragmentWithSource) =>
      (a.fragment.order ?? 500) - (b.fragment.order ?? 500);

    systemFragmentSources.sort(sortByOrder);
    flowFragmentSources.sort(sortByOrder);

    // Assemble system content
    const systemParts: string[] = [];
    for (const { fragment } of systemFragmentSources) {
      systemParts.push(fragment.content);
    }
    const systemContent = systemParts.join('\n\n');

    // Group flow fragments into messages
    const flowMessages = this.groupFlowFragments(flowFragmentSources, state);

    // Collect metadata
    const contributingComponentKeys = new Set<string>();
    const renderedChunkIds = new Set<string>();

    for (const { chunk, componentKey } of allFragments) {
      contributingComponentKeys.add(componentKey);
      renderedChunkIds.add(chunk.id);
    }

    return {
      systemContent,
      systemFragments: systemFragmentSources.map((s) => s.fragment),
      flowMessages,
      flowFragments: flowFragmentSources.map((s) => s.fragment),
      contributingComponentKeys: Array.from(contributingComponentKeys),
      renderedChunkIds: Array.from(renderedChunkIds),
    };
  }

  /**
   * Get or create a ComponentContext for rendering
   */
  private getOrCreateContext(
    threadId: string,
    componentKey: string,
    state: MemoryState,
    runtimeStates?: Map<string, ComponentRuntimeState>,
  ): ComponentContext {
    // Try to get existing runtime state
    const runtimeState = runtimeStates?.get(componentKey);

    if (runtimeState) {
      return createComponentContext(
        threadId,
        componentKey,
        state,
        runtimeState,
      );
    }

    // Create a minimal runtime state for rendering
    const minimalRuntimeState: ComponentRuntimeState = {
      componentKey,
      enabled: true,
      chunkIds: [],
      data: {},
    };

    return createComponentContext(
      threadId,
      componentKey,
      state,
      minimalRuntimeState,
    );
  }

  /**
   * Group flow fragments into messages with appropriate roles
   */
  private groupFlowFragments(
    fragmentSources: FragmentWithSource[],
    state: MemoryState,
  ): FlowMessage[] {
    const messages: FlowMessage[] = [];

    // Sort fragments by chunk order in state
    const chunkOrderMap = new Map<string, number>();
    state.chunkIds.forEach((id, index) => {
      chunkOrderMap.set(id, index);
    });

    fragmentSources.sort((a, b) => {
      const orderA = chunkOrderMap.get(a.chunk.id) ?? 0;
      const orderB = chunkOrderMap.get(b.chunk.id) ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      // Secondary sort by fragment order
      return (a.fragment.order ?? 500) - (b.fragment.order ?? 500);
    });

    // Group consecutive fragments by role
    for (const { fragment, chunk, componentKey } of fragmentSources) {
      const role = this.getChunkRole(chunk);

      if (messages.length > 0 && messages[messages.length - 1].role === role) {
        // Append to existing message
        const lastMsg = messages[messages.length - 1];
        lastMsg.content += '\n\n' + fragment.content;
        if (!lastMsg.chunkIds.includes(chunk.id)) {
          lastMsg.chunkIds.push(chunk.id);
        }
        if (!lastMsg.componentKeys.includes(componentKey)) {
          lastMsg.componentKeys.push(componentKey);
        }
      } else {
        // Start new message
        messages.push({
          role,
          content: fragment.content,
          chunkIds: [chunk.id],
          componentKeys: [componentKey],
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
 * Create a component renderer instance
 */
export function createComponentRenderer(): ComponentRenderer {
  return new ComponentRenderer();
}
