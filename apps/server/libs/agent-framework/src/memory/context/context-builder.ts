import { MemoryChunk, ChunkType } from '../types/chunk.types';
import { MemoryState } from '../types/state.types';
import { ITokenizer } from '../tokenizer/tokenizer.types';
import {
  IContextBuilder,
  IChunkRenderer,
  ContextBuildOptions,
  ContextBuildResult,
  ContextMessage,
  ContextMessageRole,
} from './context.types';
import { getDefaultRenderers } from './chunk-renderers';

/**
 * Default context builder implementation
 * Converts MemoryState to LLM-ready messages with XML-tagged chunks
 */
export class ContextBuilder implements IContextBuilder {
  private renderers: IChunkRenderer[] = [];
  private defaultTokenizer?: ITokenizer;

  constructor(defaultTokenizer?: ITokenizer) {
    // Initialize with default renderers
    this.renderers = getDefaultRenderers();
    this.defaultTokenizer = defaultTokenizer;
  }

  /**
   * Register a custom chunk renderer
   * Custom renderers take priority over default ones
   */
  registerRenderer(renderer: IChunkRenderer): void {
    // Add to the beginning so custom renderers are checked first
    this.renderers.unshift(renderer);
  }

  /**
   * Set the default tokenizer
   */
  setDefaultTokenizer(tokenizer: ITokenizer): void {
    this.defaultTokenizer = tokenizer;
  }

  /**
   * Build context from memory state
   */
  build(
    state: MemoryState,
    options: ContextBuildOptions = {},
  ): ContextBuildResult {
    const {
      maxTokens,
      tokenizer = this.defaultTokenizer,
      includeSystem = true,
      includeEnvironment = true,
      systemPrompt,
      excludeTypes = [],
      includeOnlyChunkIds,
    } = options;

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

    // Add custom system prompt if provided
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt,
      });
      tokenCount += countTokens(systemPrompt);
    }

    // Get chunks in order
    const orderedChunks = this.getOrderedChunks(state, {
      includeSystem,
      includeEnvironment,
      excludeTypes,
      includeOnlyChunkIds,
    });

    // Group consecutive chunks by role for better context
    const groupedChunks = this.groupChunksByRole(orderedChunks);

    // Render each group
    for (const group of groupedChunks) {
      const renderedContent = group.chunks
        .map((chunk) => this.renderChunk(chunk))
        .join('\n\n');

      const groupTokenCount = countTokens(renderedContent);

      // Check token limit
      if (maxTokens && tokenCount + groupTokenCount > maxTokens) {
        // Add remaining chunks to excluded list
        for (const chunk of group.chunks) {
          excludedChunkIds.push(chunk.id);
        }
        continue;
      }

      messages.push({
        role: group.role,
        content: renderedContent,
      });

      tokenCount += groupTokenCount;
      includedChunkIds.push(...group.chunks.map((c) => c.id));
    }

    return {
      messages,
      tokenCount,
      tokenCountExact,
      includedChunkIds,
      excludedChunkIds,
    };
  }

  /**
   * Get chunks in order, applying filters
   */
  private getOrderedChunks(
    state: MemoryState,
    options: {
      includeSystem: boolean;
      includeEnvironment: boolean;
      excludeTypes: ChunkType[];
      includeOnlyChunkIds?: string[];
    },
  ): MemoryChunk[] {
    const chunks: MemoryChunk[] = [];

    for (const chunkId of state.chunkIds) {
      const chunk = state.chunks.get(chunkId);
      if (!chunk) continue;

      // Apply includeOnlyChunkIds filter
      if (
        options.includeOnlyChunkIds &&
        !options.includeOnlyChunkIds.includes(chunkId)
      ) {
        continue;
      }

      // Apply type exclusions
      if (options.excludeTypes.includes(chunk.type)) {
        continue;
      }

      // Apply system/environment filters
      if (!options.includeSystem && chunk.type === ChunkType.SYSTEM) {
        continue;
      }
      if (!options.includeEnvironment && chunk.type === ChunkType.ENVIRONMENT) {
        continue;
      }

      chunks.push(chunk);
    }

    return chunks;
  }

  /**
   * Group consecutive chunks by their message role
   */
  private groupChunksByRole(
    chunks: MemoryChunk[],
  ): Array<{ role: ContextMessageRole; chunks: MemoryChunk[] }> {
    const groups: Array<{ role: ContextMessageRole; chunks: MemoryChunk[] }> =
      [];

    for (const chunk of chunks) {
      const role = this.getChunkRole(chunk);

      // If this chunk has the same role as the last group, add to that group
      if (groups.length > 0 && groups[groups.length - 1].role === role) {
        groups[groups.length - 1].chunks.push(chunk);
      } else {
        // Start a new group
        groups.push({ role, chunks: [chunk] });
      }
    }

    return groups;
  }

  /**
   * Get the message role for a chunk
   */
  private getChunkRole(chunk: MemoryChunk): ContextMessageRole {
    const renderer = this.findRenderer(chunk);
    if (renderer) {
      return renderer.getRole(chunk);
    }
    // Default fallback
    return 'user';
  }

  /**
   * Render a chunk to XML-tagged string
   */
  private renderChunk(chunk: MemoryChunk): string {
    const renderer = this.findRenderer(chunk);
    if (renderer) {
      return renderer.render(chunk);
    }

    // Fallback rendering
    return `<chunk id="${chunk.id}" type="${chunk.type}">\n${JSON.stringify(chunk.content, null, 2)}\n</chunk>`;
  }

  /**
   * Find a renderer that can handle the given chunk
   */
  private findRenderer(chunk: MemoryChunk): IChunkRenderer | undefined {
    return this.renderers.find((r) => r.canRender(chunk));
  }
}

/**
 * Create a new context builder with default renderers
 * @param tokenizer - Optional tokenizer for accurate token counting
 */
export function createContextBuilder(tokenizer?: ITokenizer): ContextBuilder {
  return new ContextBuilder(tokenizer);
}
