/**
 * Abstract Component Base Class
 * Provides default implementations for IComponent interface
 */

import type { MemoryChunk } from '../../types/chunk.types.js';
import type { MemoryState } from '../../types/state.types.js';
import type { AgentEvent } from '../../types/event.types.js';
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
        componentId: this.id,
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
      if (chunk.componentId === this.id) {
        ids.push(id);
      }
    }
    return ids;
  }

  // ============ Tools ============

  getTools(): Tool[] {
    return this.tools;
  }

  // ============ Event Handling ============

  /**
   * Default implementation: no events handled
   * Subclasses should override to handle specific events
   */
  getReducersForEvent(_event: AgentEvent): ComponentReducerFn[] {
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
