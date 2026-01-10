import { MemoryThread } from '../types/thread.types.js';
import { MemoryState } from '../types/state.types.js';
import {
  MemoryChunk,
  ChunkType,
  ChunkRetentionStrategy,
  ChunkContentType,
  TextContent,
} from '../types/chunk.types.js';
import { ILLMAdapter, LLMConfig } from '../llm/llm.types.js';
import type { ObserverManager } from '../observer/observer.types.js';
import { ITokenizer } from '../tokenizer/tokenizer.types.js';
import { createTokenizer } from '../tokenizer/tiktoken.tokenizer.js';
import { Compactor, type ComponentLookup } from '../compactor/index.js';
import type { ReducerResult } from '../reducer/reducer.types.js';

/**
 * Result of dispatching an event (re-exported for compaction)
 */
export interface DispatchResult {
  /** The updated thread */
  thread: Readonly<MemoryThread>;
  /** The new state after processing the event */
  state: Readonly<MemoryState>;
  /** Chunks that were added */
  addedChunks: MemoryChunk[];
  /** Chunk IDs that were removed */
  removedChunkIds: string[];
}

/**
 * Interface for runtime coordination operations needed by CompactionManager
 * AgentOrchestrator implements this interface
 */
export interface ICompactionCoordinator {
  getCurrentState(threadId: string): Promise<Readonly<MemoryState> | null>;
  applyReducerResult(
    threadId: string,
    reducerResult: ReducerResult,
  ): Promise<DispatchResult>;
}

/**
 * Token threshold configuration for memory management
 */
export interface TokenThresholds {
  /** Soft threshold - suggests compaction when reached */
  softThreshold: number;
  /** Hard threshold - forces compaction when reached */
  hardThreshold: number;
  /** Truncation threshold - truncates oldest content when exceeded */
  truncationThreshold: number;
}

/**
 * Result of token usage check
 */
export interface TokenCheckResult {
  /** Total tokens in state */
  totalTokens: number;
  /** Tokens in compressible chunks */
  compressibleTokens: number;
  /** Whether compaction is suggested (soft threshold reached) */
  suggestCompaction: boolean;
  /** Whether compaction is forced (hard threshold reached) */
  forceCompaction: boolean;
  /** Whether truncation is needed (truncation threshold reached) */
  needsTruncation: boolean;
  /** Chunks suggested for compaction */
  chunksToCompact: MemoryChunk[];
  /** Chunk IDs to truncate (oldest conversation chunks first) */
  chunksToTruncate: string[];
}

/**
 * Configuration for CompactionManager
 */
export interface CompactionManagerConfig {
  /** LLM configuration for compaction */
  llm: LLMConfig;
  /** Whether to enable auto-compaction */
  autoCompactEnabled?: boolean;
  /** Token-based threshold configuration */
  tokenThresholds?: Partial<TokenThresholds>;
}

/**
 * Default token thresholds
 */
const DEFAULT_TOKEN_THRESHOLDS: TokenThresholds = {
  softThreshold: 50000, // 50K tokens - suggest compaction
  hardThreshold: 80000, // 80K tokens - force compaction
  truncationThreshold: 100000, // 100K tokens - start truncating
};

/**
 * Conversation chunk types that can be compacted
 */
const CONVERSATION_CHUNK_TYPES = [
  ChunkType.USER_MESSAGE,
  ChunkType.AGENT_RESPONSE,
  ChunkType.THINKING,
  ChunkType.AGENT_ACTION,
  ChunkType.ACTION_RESPONSE,
  ChunkType.SUBAGENT_SPAWN,
  ChunkType.SUBAGENT_RESULT,
  ChunkType.PARENT_MESSAGE,
  ChunkType.COMPACTED,
];

/**
 * CompactionManager handles memory compaction logic
 * Uses token-based thresholds for intelligent memory management
 * Delegates actual compaction to Compactor class
 */
export class CompactionManager {
  private config: CompactionManagerConfig;
  private tokenizer: ITokenizer;
  private tokenThresholds: TokenThresholds;
  private compactor: Compactor;

  constructor(llmAdapter: ILLMAdapter, config: CompactionManagerConfig) {
    this.config = {
      autoCompactEnabled: true,
      ...config,
    };

    // Create tokenizer based on LLM model
    this.tokenizer = createTokenizer(config.llm.model);

    // Set token thresholds with defaults
    this.tokenThresholds = {
      ...DEFAULT_TOKEN_THRESHOLDS,
      ...config.tokenThresholds,
    };

    // Create Compactor instance
    this.compactor = new Compactor(llmAdapter, {
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxTokens,
    });
  }

  /**
   * Check token usage and determine compaction/truncation needs
   * @param state - The current memory state
   * @returns Token check result with thresholds status
   */
  checkTokenUsage(state: MemoryState): TokenCheckResult {
    let totalTokens = 0;
    let compressibleTokens = 0;
    const compressibleChunks: MemoryChunk[] = [];
    const conversationChunks: Array<{
      chunk: MemoryChunk;
      tokens: number;
      createdAt: number;
    }> = [];

    for (const chunk of state.chunks.values()) {
      const tokens = this.countChunkTokens(chunk);
      totalTokens += tokens;

      if (this.isCompressible(chunk)) {
        compressibleTokens += tokens;
        compressibleChunks.push(chunk);
      }

      if (CONVERSATION_CHUNK_TYPES.includes(chunk.type)) {
        conversationChunks.push({
          chunk,
          tokens,
          createdAt: chunk.metadata.createdAt,
        });
      }
    }

    const suggestCompaction = totalTokens >= this.tokenThresholds.softThreshold;
    const forceCompaction = totalTokens >= this.tokenThresholds.hardThreshold;
    const needsTruncation =
      totalTokens >= this.tokenThresholds.truncationThreshold;

    // Calculate chunks to truncate if needed (oldest conversation chunks first)
    let chunksToTruncate: string[] = [];
    if (needsTruncation) {
      const excessTokens = totalTokens - this.tokenThresholds.hardThreshold;
      chunksToTruncate = this.selectChunksToTruncate(
        conversationChunks,
        excessTokens,
      );
    }

    return {
      totalTokens,
      compressibleTokens,
      suggestCompaction,
      forceCompaction,
      needsTruncation,
      chunksToCompact: compressibleChunks,
      chunksToTruncate,
    };
  }

  /**
   * Count tokens for a single chunk
   */
  private countChunkTokens(chunk: MemoryChunk): number {
    const text = this.extractChunkText(chunk);
    return this.tokenizer.countTokens(text);
  }

  /**
   * Extract text content from a chunk for token counting
   */
  private extractChunkText(chunk: MemoryChunk): string {
    const content = chunk.content;
    if ('text' in content && typeof content.text === 'string') {
      return content.text;
    }
    if ('parts' in content && Array.isArray(content.parts)) {
      return (content.parts as Array<{ type: string; text?: string }>)
        .filter(
          (p): p is TextContent =>
            p.type === ChunkContentType.TEXT && typeof p.text === 'string',
        )
        .map((p) => p.text)
        .join('\n');
    }
    return JSON.stringify(content);
  }

  /**
   * Check if a chunk is compressible
   */
  private isCompressible(chunk: MemoryChunk): boolean {
    return (
      CONVERSATION_CHUNK_TYPES.includes(chunk.type) &&
      (chunk.retentionStrategy === ChunkRetentionStrategy.COMPRESSIBLE ||
        chunk.retentionStrategy === ChunkRetentionStrategy.BATCH_COMPRESSIBLE ||
        chunk.retentionStrategy === ChunkRetentionStrategy.DISPOSABLE)
    );
  }

  /**
   * Select chunks to truncate based on creation time (oldest first)
   */
  private selectChunksToTruncate(
    conversationChunks: Array<{
      chunk: MemoryChunk;
      tokens: number;
      createdAt: number;
    }>,
    excessTokens: number,
  ): string[] {
    // Sort by creation time (oldest first)
    const sorted = [...conversationChunks].sort(
      (a, b) => a.createdAt - b.createdAt,
    );

    const toTruncate: string[] = [];
    let tokensToRemove = excessTokens;

    for (const item of sorted) {
      if (tokensToRemove <= 0) break;
      toTruncate.push(item.chunk.id);
      tokensToRemove -= item.tokens;
    }

    return toTruncate;
  }

  /**
   * Get compressible chunks from state
   */
  getCompressibleChunks(state: MemoryState): MemoryChunk[] {
    return Array.from(state.chunks.values()).filter((chunk) =>
      this.isCompressible(chunk),
    );
  }

  /**
   * Execute compaction using Compactor.
   * Compactor identifies chunks to compact and delegates to component's compactChunk method.
   *
   * @param threadId - The thread ID
   * @param coordinator - Runtime coordinator for state operations
   * @param observerManager - Observer manager for notifications
   * @param componentLookup - Optional function to find component for chunk (provided by ComponentManager)
   * @returns The dispatch result after compaction
   */
  async executeCompaction(
    threadId: string,
    coordinator: ICompactionCoordinator,
    observerManager: ObserverManager,
    componentLookup?: ComponentLookup,
  ): Promise<DispatchResult> {
    // Get current state
    const currentState = await coordinator.getCurrentState(threadId);
    if (!currentState) {
      throw new Error(`Current state not found for thread: ${threadId}`);
    }

    // Get chunks to compact
    const chunksToCompact = this.compactor.getChunksToCompact(currentState);

    // Notify observers of compaction start
    observerManager.notifyCompactionStart({
      threadId,
      chunkCount: chunksToCompact.length,
      chunkIds: chunksToCompact.map((c) => c.chunk.id),
      timestamp: Date.now(),
    });

    // Run compaction using Compactor (delegates to component's compactChunk)
    const reducerResult = await this.compactor.compactToReducerResult(
      currentState,
      componentLookup,
    );

    // Apply through coordinator
    const result = await coordinator.applyReducerResult(
      threadId,
      reducerResult,
    );

    // Get compaction result for observer notification
    const compactedChunk = reducerResult.chunks[0];
    const originalChunkIds =
      chunksToCompact.length > 0
        ? (chunksToCompact[0].chunk.childIds ?? []).filter((id) => {
            const chunk = currentState.chunks.get(id);
            return chunk && this.isCompressible(chunk);
          })
        : [];

    // Notify observers of compaction end
    observerManager.notifyCompactionEnd({
      threadId,
      tokensBefore: 0, // Token counting handled by Compactor internally
      tokensAfter: 0,
      compactedChunkId: compactedChunk?.id ?? '',
      originalChunkIds,
      timestamp: Date.now(),
    });

    return result;
  }

  /**
   * Check if auto-compaction is enabled
   */
  isAutoCompactEnabled(): boolean {
    return this.config.autoCompactEnabled ?? true;
  }

  /**
   * Get the token thresholds configuration
   */
  getTokenThresholds(): Readonly<TokenThresholds> {
    return this.tokenThresholds;
  }
}
