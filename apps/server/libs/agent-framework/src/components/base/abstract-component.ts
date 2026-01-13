/**
 * Abstract Component Base Class
 * Provides default implementations for IComponent interface
 */

import type { MemoryChunk, ChunkType } from '../../types/chunk.types.js';
import type { MemoryState } from '../../types/state.types.js';
import type { BaseEvent } from '../../types/event.types.js';
import type { Tool } from '../../tools/tool.types.js';
import { createChunk } from '../../factories/chunk.factory.js';
import type {
  IComponent,
  NewComponentType,
  ComponentContext,
  ComponentChunkConfig,
  ComponentReducerFn,
  RenderedFragment,
} from '../component.interface.js';

/**
 * Extract text content from a chunk
 */
function extractTextContent(chunk: MemoryChunk): string {
  const content = chunk.content;
  if (content.type === 'TEXT') {
    return (content as { type: 'TEXT'; text: string }).text;
  }
  if (content.type === 'MIXED') {
    const mixed = content as {
      type: 'MIXED';
      parts: Array<{ type: string; text?: string }>;
    };
    return mixed.parts
      .filter((p) => p.type === 'TEXT')
      .map((p) => p.text || '')
      .join('\n');
  }
  return JSON.stringify(content);
}

/**
 * Abstract base class for components
 * Provides sensible defaults and common functionality
 */
export abstract class AbstractComponent implements IComponent {
  // ============ Abstract Properties (must be implemented) ============

  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly type: NewComponentType;

  // ============ Optional Properties ============

  readonly dependencies?: string[];

  /**
   * ChunkTypes this component is responsible for (used by truncation)
   * Override in subclass to declare which chunk types this component handles.
   * When truncation needs to reduce context, it will ask components to truncate
   * their owned chunks based on this type matching.
   */
  readonly responsibleChunkTypes: ChunkType[] = [];

  /**
   * Event types this component can handle
   * Used by ReducerRegistry to route events to the correct component.
   * Override in subclass to declare which events this component handles.
   */
  readonly supportedEventTypes: readonly string[] = [];

  // ============ Protected State ============

  protected chunkConfigs: ComponentChunkConfig[] = [];
  protected tools: Tool[] = [];

  // ============ Lifecycle Hooks (optional overrides) ============

  onInitialize?(context: ComponentContext): Promise<void> | void;
  onActivate?(context: ComponentContext): Promise<void> | void;
  onDeactivate?(context: ComponentContext): Promise<void> | void;
  onDestroy?(context: ComponentContext): Promise<void> | void;

  // ============ Chunk Management ============

  getChunkConfigs(): ComponentChunkConfig[] {
    return this.chunkConfigs;
  }

  createInitialChunks(context: ComponentContext): MemoryChunk[] {
    return this.chunkConfigs.map((config) => {
      const content =
        typeof config.initialContent === 'function'
          ? config.initialContent(context)
          : config.initialContent;

      return createChunk({
        componentKey: this.id,
        chunkKey: config.key,
        type: config.type,
        content,
        retentionStrategy: config.retentionStrategy,
        mutable: config.mutable,
        priority: config.priority,
      });
    });
  }

  getOwnedChunkIds(state: MemoryState): string[] {
    const ids: string[] = [];
    for (const [id, chunk] of state.chunks) {
      if (chunk.componentKey === this.id) {
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * Get chunks owned by this component based on responsibleChunkTypes
   * Used by truncation to find chunks this component can truncate.
   * Matches chunks by their type against this.responsibleChunkTypes.
   *
   * @param state - Current memory state
   * @returns Array of chunks whose type is in responsibleChunkTypes
   */
  getOwnedChunks(state: MemoryState): MemoryChunk[] {
    if (this.responsibleChunkTypes.length === 0) {
      return [];
    }
    return Array.from(state.chunks.values()).filter((chunk) =>
      this.responsibleChunkTypes.includes(chunk.type),
    );
  }

  // ============ Tools ============

  getTools(): Tool[] {
    return this.tools;
  }

  // ============ Event Handling ============

  /**
   * Check if this component supports the given event type
   * @param eventType - The event type to check
   * @returns true if this component handles the event type
   */
  supportsEventType(eventType: string): boolean {
    return this.supportedEventTypes.includes(eventType);
  }

  /**
   * Get reducers for an event
   * This is the public method that checks supportedEventTypes first,
   * then delegates to getReducersForEventImpl() for actual reducer logic.
   *
   * Subclasses should override getReducersForEventImpl() instead of this method.
   */
  getReducersForEvent(event: BaseEvent): ComponentReducerFn[] {
    // Check if this component handles this event type
    if (!this.supportsEventType(event.type)) {
      return [];
    }

    // Delegate to implementation method
    return this.getReducersForEventImpl(event);
  }

  /**
   * Implementation method for getting reducers for a specific event
   * Subclasses should override this method to provide actual reducer logic.
   *
   * This method is only called if the event type is in supportedEventTypes,
   * so subclasses don't need to check event types again.
   *
   * @param event - The event to get reducers for (guaranteed to be a supported type)
   * @returns Array of reducer functions to execute
   */
  protected getReducersForEventImpl(_event: BaseEvent): ComponentReducerFn[] {
    return [];
  }

  // ============ Rendering ============

  /**
   * Default rendering implementation
   * Renders chunk content as XML-tagged text in system prompt
   */
  renderChunk(
    chunk: MemoryChunk,
    _context: ComponentContext,
  ): RenderedFragment[] {
    const config = this.findChunkConfig(chunk);
    const content = extractTextContent(chunk);

    if (!content.trim()) {
      return [];
    }

    const tagName = config?.key ?? chunk.type.toLowerCase();

    return [
      {
        content: `<${tagName} id="${chunk.id}">\n${content}\n</${tagName}>`,
        location: 'system',
        order: 500,
      },
    ];
  }

  // ============ Protected Helpers ============

  /**
   * Find chunk config by chunk key
   */
  protected findChunkConfig(
    chunk: MemoryChunk,
  ): ComponentChunkConfig | undefined {
    return this.chunkConfigs.find((c) => c.key === chunk.chunkKey);
  }

  /**
   * Register a chunk configuration
   */
  protected registerChunkConfig(config: ComponentChunkConfig): void {
    this.chunkConfigs.push(config);
  }

  /**
   * Register a tool
   */
  protected registerTool(tool: Tool): void {
    this.tools.push(tool);
  }
}
