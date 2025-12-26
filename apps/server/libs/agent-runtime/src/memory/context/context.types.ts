import { MemoryChunk, ChunkType } from '../types/chunk.types';
import { MemoryState } from '../types/state.types';
import { ITokenizer } from '../tokenizer/tokenizer.types';

/**
 * Message role for LLM context
 */
export type ContextMessageRole = 'system' | 'user' | 'assistant';

/**
 * A single message in the LLM context
 */
export interface ContextMessage {
  role: ContextMessageRole;
  content: string;
}

/**
 * Result of building context from memory state
 */
export interface ContextBuildResult {
  /** Messages to send to LLM */
  messages: ContextMessage[];
  /** Token count (exact if tokenizer provided, estimated otherwise) */
  tokenCount: number;
  /** Whether token count is exact (true) or estimated (false) */
  tokenCountExact: boolean;
  /** Chunks that were included */
  includedChunkIds: string[];
  /** Chunks that were excluded (e.g., due to token limit) */
  excludedChunkIds: string[];
}

/**
 * Options for building context
 */
export interface ContextBuildOptions {
  /** Maximum tokens allowed */
  maxTokens?: number;
  /** Tokenizer to use for accurate token counting */
  tokenizer?: ITokenizer;
  /** Whether to include system chunks */
  includeSystem?: boolean;
  /** Whether to include environment chunks */
  includeEnvironment?: boolean;
  /** Custom system prompt to prepend */
  systemPrompt?: string;
  /** Chunk types to exclude */
  excludeTypes?: ChunkType[];
  /** Specific chunk IDs to include (if set, only these are included) */
  includeOnlyChunkIds?: string[];
}

/**
 * Renderer for a specific chunk type
 */
export interface IChunkRenderer {
  /**
   * Check if this renderer can handle the given chunk
   */
  canRender(chunk: MemoryChunk): boolean;

  /**
   * Render a chunk to XML-tagged string
   */
  render(chunk: MemoryChunk): string;

  /**
   * Get the message role for this chunk type
   */
  getRole(chunk: MemoryChunk): ContextMessageRole;
}

/**
 * Context builder interface
 */
export interface IContextBuilder {
  /**
   * Build context from memory state
   */
  build(state: MemoryState, options?: ContextBuildOptions): ContextBuildResult;

  /**
   * Register a custom chunk renderer
   */
  registerRenderer(renderer: IChunkRenderer): void;
}
