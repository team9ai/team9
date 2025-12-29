import { MemoryState } from '../types/state.types.js';
import {
  MemoryChunk,
  ChunkType,
  ChunkRetentionStrategy,
  ChunkContentType,
  TextContent,
} from '../types/chunk.types.js';
import { ICompactor, CompactionContext } from '../compactor/compactor.types.js';
import { WorkingFlowCompactor } from '../compactor/working-flow.compactor.js';
import { ILLMAdapter, LLMConfig } from '../llm/llm.types.js';
import { ThreadManager } from './thread.manager.js';
import { createBatchReplaceOperation } from '../factories/operation.factory.js';
import type { ObserverManager } from '../observer/observer.types.js';
import type { DispatchResult } from './memory.manager.js';
import { ITokenizer } from '../tokenizer/tokenizer.types.js';
import { createTokenizer } from '../tokenizer/tiktoken.tokenizer.js';

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
  /** Chunk IDs to truncate (oldest WORKING_FLOW chunks first) */
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
 * CompactionManager handles memory compaction logic
 * Uses token-based thresholds for intelligent memory management
 */
export class CompactionManager {
  private compactors: ICompactor[] = [];
  private config: CompactionManagerConfig;
  private tokenizer: ITokenizer;
  private tokenThresholds: TokenThresholds;

  constructor(
    private llmAdapter: ILLMAdapter,
    config: CompactionManagerConfig,
  ) {
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

    // Initialize default compactors
    this.compactors.push(new WorkingFlowCompactor(llmAdapter, config.llm));
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
    const workingFlowChunks: Array<{
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

      if (chunk.type === ChunkType.WORKING_FLOW) {
        workingFlowChunks.push({
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

    // Calculate chunks to truncate if needed (oldest WORKING_FLOW chunks first)
    let chunksToTruncate: string[] = [];
    if (needsTruncation) {
      const excessTokens = totalTokens - this.tokenThresholds.hardThreshold;
      chunksToTruncate = this.selectChunksToTruncate(
        workingFlowChunks,
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
      chunk.type === ChunkType.WORKING_FLOW &&
      (chunk.retentionStrategy === ChunkRetentionStrategy.COMPRESSIBLE ||
        chunk.retentionStrategy === ChunkRetentionStrategy.BATCH_COMPRESSIBLE ||
        chunk.retentionStrategy === ChunkRetentionStrategy.DISPOSABLE)
    );
  }

  /**
   * Select chunks to truncate based on creation time (oldest first)
   */
  private selectChunksToTruncate(
    workingFlowChunks: Array<{
      chunk: MemoryChunk;
      tokens: number;
      createdAt: number;
    }>,
    excessTokens: number,
  ): string[] {
    // Sort by creation time (oldest first)
    const sorted = [...workingFlowChunks].sort(
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
   * Execute compaction for specific chunks
   *
   * @param threadId - The thread ID
   * @param chunks - Chunks to compact
   * @param threadManager - Thread manager for state operations
   * @param observerManager - Observer manager for notifications
   * @returns The dispatch result after compaction
   */
  async executeCompaction(
    threadId: string,
    chunks: MemoryChunk[],
    threadManager: ThreadManager,
    observerManager: ObserverManager,
  ): Promise<DispatchResult> {
    // Get current state
    const currentState = await threadManager.getCurrentState(threadId);
    if (!currentState) {
      throw new Error(`Current state not found for thread: ${threadId}`);
    }

    if (chunks.length === 0) {
      const thread = await threadManager.getThread(threadId);
      if (!thread) {
        throw new Error(`Thread not found: ${threadId}`);
      }
      return {
        thread,
        state: currentState,
        addedChunks: [],
        removedChunkIds: [],
      };
    }

    // Notify observers of compaction start
    const chunkIds = chunks.map((c) => c.id);
    observerManager.notifyCompactionStart({
      threadId,
      chunkCount: chunks.length,
      chunkIds,
      timestamp: Date.now(),
    });

    // Find a suitable compactor
    const compactor = this.compactors.find((c) => c.canCompact(chunks));
    if (!compactor) {
      throw new Error('No suitable compactor found for chunks');
    }

    // Build compaction context
    const context: CompactionContext = {
      state: currentState,
      taskGoal: this.extractTaskGoal(currentState),
      progressSummary: this.extractProgressSummary(currentState),
    };

    // Run compaction
    const compactionResult = await compactor.compact(chunks, context);

    // Create batch replace operation
    const operation = createBatchReplaceOperation(
      compactionResult.originalChunkIds,
      compactionResult.compactedChunk.id,
    );

    // Apply through thread manager
    const result = await threadManager.applyReducerResult(threadId, {
      operations: [operation],
      chunks: [compactionResult.compactedChunk],
    });

    // Notify observers of compaction end
    observerManager.notifyCompactionEnd({
      threadId,
      tokensBefore: compactionResult.tokensBefore ?? 0,
      tokensAfter: compactionResult.tokensAfter ?? 0,
      compactedChunkId: compactionResult.compactedChunk.id,
      originalChunkIds: compactionResult.originalChunkIds,
      timestamp: Date.now(),
    });

    return result;
  }

  /**
   * Extract task goal from state (for compaction context)
   */
  private extractTaskGoal(state: MemoryState): string | undefined {
    // Look for system chunks or delegation chunks with task info
    for (const chunk of state.chunks.values()) {
      if (
        chunk.type === ChunkType.SYSTEM ||
        chunk.type === ChunkType.DELEGATION
      ) {
        const content = chunk.content;
        if ('task' in content && typeof content.task === 'string') {
          return content.task;
        }
        if ('taskContext' in content && content.taskContext) {
          const ctx = content.taskContext as Record<string, unknown>;
          if ('goal' in ctx && typeof ctx.goal === 'string') {
            return ctx.goal;
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Extract progress summary from state (for compaction context)
   */
  private extractProgressSummary(state: MemoryState): string | undefined {
    // Look for existing compacted chunks
    for (const chunk of state.chunks.values()) {
      if (
        chunk.type === ChunkType.WORKING_FLOW &&
        chunk.metadata.custom?.subType === 'COMPACTED'
      ) {
        const content = chunk.content;
        if ('text' in content && typeof content.text === 'string') {
          return content.text;
        }
      }
    }
    return undefined;
  }

  /**
   * Register a custom compactor
   * @param compactor - The compactor to register
   */
  registerCompactor(compactor: ICompactor): void {
    this.compactors.push(compactor);
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
