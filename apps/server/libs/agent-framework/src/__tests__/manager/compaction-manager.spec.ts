/**
 * Unit tests for CompactionManager
 */
import {
  CompactionManager,
  CompactionManagerConfig,
} from '../../manager/compaction.manager.js';
import { MemoryState } from '../../types/state.types.js';
import {
  MemoryChunk,
  ChunkType,
  ChunkRetentionStrategy,
  ChunkContentType,
  ChunkContent,
} from '../../types/chunk.types.js';
import type { ILLMAdapter } from '../../llm/llm.types.js';
import type { ObserverManager } from '../../observer/observer.types.js';
import type { IMemoryManager } from '../../manager/memory-manager.interface.js';
import type { IStateTransitionManager } from '../../manager/state-transition.manager.js';
import type {
  IComponent,
  ComponentCompactionConfig,
} from '../../components/component.interface.js';
import { compactWorkingHistory } from '../../components/base/working-history/working-history.compactor.js';
import type { ComponentLookup } from '../../compactor/index.js';

// Mock LLM adapter
const createMockLLMAdapter = (): ILLMAdapter => ({
  complete: jest.fn().mockResolvedValue({ content: 'Compacted summary' }),
});

// Mock config
const createMockConfig = (
  overrides?: Partial<CompactionManagerConfig>,
): CompactionManagerConfig => ({
  llm: {
    model: 'gpt-4',
    maxTokens: 1000,
  },
  autoCompactEnabled: true,
  tokenThresholds: {
    softThreshold: 100, // Low threshold for testing
    hardThreshold: 200,
    truncationThreshold: 300,
  },
  ...overrides,
});

// Helper to create mock chunks
const createMockChunk = (
  id: string,
  options?: {
    type?: ChunkType;
    retentionStrategy?: ChunkRetentionStrategy;
    content?: ChunkContent;
    custom?: Record<string, unknown>;
    createdAt?: number;
    childIds?: string[];
  },
): MemoryChunk => ({
  id,
  type: options?.type ?? ChunkType.THINKING,
  content: options?.content ?? {
    type: ChunkContentType.TEXT,
    text: 'test content',
  },
  childIds: options?.childIds,
  retentionStrategy:
    options?.retentionStrategy ?? ChunkRetentionStrategy.COMPRESSIBLE,
  mutable: false,
  priority: 0,
  metadata: {
    createdAt: options?.createdAt ?? Date.now(),
    custom: options?.custom,
  },
});

// Helper to create mock state
const createMockState = (chunks: MemoryChunk[]): MemoryState => {
  const chunkMap = new Map<string, MemoryChunk>();
  chunks.forEach((c) => chunkMap.set(c.id, c));
  return {
    id: 'state-1',
    threadId: 'thread-1',
    chunkIds: chunks.map((c) => c.id),
    chunks: chunkMap,
    metadata: {
      createdAt: Date.now(),
    },
  };
};

// Helper to create state with WORKING_HISTORY
const createStateWithWorkingHistory = (
  conversationChunks: MemoryChunk[],
): MemoryState => {
  const workingHistoryChunk = createMockChunk('working-history-1', {
    type: ChunkType.WORKING_HISTORY,
    content: { type: ChunkContentType.TEXT, text: '' },
    childIds: conversationChunks.map((c) => c.id),
  });

  return createMockState([workingHistoryChunk, ...conversationChunks]);
};

/**
 * Create a componentLookup function that returns the mock component for WORKING_HISTORY chunks
 */
const createMockComponentLookup = (
  component: Partial<IComponent>,
): ComponentLookup => {
  return (chunk: MemoryChunk) => {
    if (chunk.type === ChunkType.WORKING_HISTORY) {
      return component as IComponent;
    }
    return undefined;
  };
};

describe('CompactionManager', () => {
  let llmAdapter: ILLMAdapter;
  let config: CompactionManagerConfig;
  let manager: CompactionManager;

  beforeEach(() => {
    llmAdapter = createMockLLMAdapter();
    config = createMockConfig();
    manager = new CompactionManager(llmAdapter, config);
  });

  describe('constructor', () => {
    it('should use default token thresholds', () => {
      const mgr = new CompactionManager(llmAdapter, {
        llm: { model: 'gpt-4', maxTokens: 1000 },
      });
      const thresholds = mgr.getTokenThresholds();
      expect(thresholds.softThreshold).toBe(50000);
      expect(thresholds.hardThreshold).toBe(80000);
      expect(thresholds.truncationThreshold).toBe(100000);
    });

    it('should use provided token thresholds', () => {
      const mgr = new CompactionManager(llmAdapter, {
        llm: { model: 'gpt-4', maxTokens: 1000 },
        tokenThresholds: {
          softThreshold: 1000,
          hardThreshold: 2000,
          truncationThreshold: 3000,
        },
      });
      const thresholds = mgr.getTokenThresholds();
      expect(thresholds.softThreshold).toBe(1000);
      expect(thresholds.hardThreshold).toBe(2000);
      expect(thresholds.truncationThreshold).toBe(3000);
    });

    it('should enable auto-compaction by default', () => {
      const mgr = new CompactionManager(llmAdapter, {
        llm: { model: 'gpt-4', maxTokens: 1000 },
      });
      expect(mgr.isAutoCompactEnabled()).toBe(true);
    });

    it('should allow disabling auto-compaction', () => {
      const mgr = new CompactionManager(llmAdapter, {
        llm: { model: 'gpt-4', maxTokens: 1000 },
        autoCompactEnabled: false,
      });
      expect(mgr.isAutoCompactEnabled()).toBe(false);
    });
  });

  describe('getCompressibleChunks', () => {
    it('should return empty array for empty state', () => {
      const state = createMockState([]);
      const result = manager.getCompressibleChunks(state);
      expect(result).toEqual([]);
    });

    it('should return conversation chunks with COMPRESSIBLE retention', () => {
      const compressibleChunk = createMockChunk('c1', {
        type: ChunkType.THINKING,
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });
      const criticalChunk = createMockChunk('c2', {
        type: ChunkType.THINKING,
        retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      });
      const state = createMockState([compressibleChunk, criticalChunk]);

      const result = manager.getCompressibleChunks(state);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('c1');
    });

    it('should return BATCH_COMPRESSIBLE chunks', () => {
      const chunk = createMockChunk('c1', {
        type: ChunkType.THINKING,
        retentionStrategy: ChunkRetentionStrategy.BATCH_COMPRESSIBLE,
      });
      const state = createMockState([chunk]);

      const result = manager.getCompressibleChunks(state);

      expect(result).toHaveLength(1);
    });

    it('should return DISPOSABLE chunks', () => {
      const chunk = createMockChunk('c1', {
        type: ChunkType.THINKING,
        retentionStrategy: ChunkRetentionStrategy.DISPOSABLE,
      });
      const state = createMockState([chunk]);

      const result = manager.getCompressibleChunks(state);

      expect(result).toHaveLength(1);
    });

    it('should not return non-conversation chunks', () => {
      const systemChunk = createMockChunk('c1', {
        type: ChunkType.SYSTEM,
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });
      const agentChunk = createMockChunk('c2', {
        type: ChunkType.AGENT,
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });
      const state = createMockState([systemChunk, agentChunk]);

      const result = manager.getCompressibleChunks(state);

      expect(result).toHaveLength(0);
    });
  });

  describe('checkTokenUsage', () => {
    it('should return zero totals for empty state', () => {
      const state = createMockState([]);
      const result = manager.checkTokenUsage(state);

      expect(result.totalTokens).toBe(0);
      expect(result.compressibleTokens).toBe(0);
      expect(result.suggestCompaction).toBe(false);
      expect(result.forceCompaction).toBe(false);
      expect(result.needsTruncation).toBe(false);
    });

    it('should count tokens in chunks', () => {
      // Create chunks with known content
      const chunk = createMockChunk('c1', {
        content: { type: ChunkContentType.TEXT, text: 'Hello world' },
      });
      const state = createMockState([chunk]);

      const result = manager.checkTokenUsage(state);

      expect(result.totalTokens).toBeGreaterThan(0);
      expect(result.compressibleTokens).toBeGreaterThan(0);
    });

    it('should suggest compaction when soft threshold reached', () => {
      // Create manager with very low threshold for testing
      const mgr = new CompactionManager(llmAdapter, {
        llm: { model: 'gpt-4', maxTokens: 1000 },
        tokenThresholds: {
          softThreshold: 10,
          hardThreshold: 100,
          truncationThreshold: 200,
        },
      });

      const chunk = createMockChunk('c1', {
        content: {
          type: ChunkContentType.TEXT,
          text: 'Hello world, this is a test message with enough tokens.',
        },
      });
      const state = createMockState([chunk]);

      const result = mgr.checkTokenUsage(state);

      expect(result.suggestCompaction).toBe(true);
      expect(result.forceCompaction).toBe(false);
    });

    it('should force compaction when hard threshold reached', () => {
      // Create manager with very low threshold for testing
      const mgr = new CompactionManager(llmAdapter, {
        llm: { model: 'gpt-4', maxTokens: 1000 },
        tokenThresholds: {
          softThreshold: 5,
          hardThreshold: 10,
          truncationThreshold: 200,
        },
      });

      const chunk = createMockChunk('c1', {
        content: {
          type: ChunkContentType.TEXT,
          text: 'Hello world, this is a test message with enough tokens.',
        },
      });
      const state = createMockState([chunk]);

      const result = mgr.checkTokenUsage(state);

      expect(result.suggestCompaction).toBe(true);
      expect(result.forceCompaction).toBe(true);
      expect(result.chunksToCompact.length).toBeGreaterThan(0);
    });

    it('should identify chunks to truncate when truncation threshold reached', () => {
      const mgr = new CompactionManager(llmAdapter, {
        llm: { model: 'gpt-4', maxTokens: 1000 },
        tokenThresholds: {
          softThreshold: 5,
          hardThreshold: 10,
          truncationThreshold: 15,
        },
      });

      // Create chunks with different creation times
      const now = Date.now();
      const oldChunk = createMockChunk('old-chunk', {
        content: {
          type: ChunkContentType.TEXT,
          text: 'Old content that should be truncated first.',
        },
        createdAt: now - 10000,
      });
      const newChunk = createMockChunk('new-chunk', {
        content: {
          type: ChunkContentType.TEXT,
          text: 'New content that should be kept longer.',
        },
        createdAt: now,
      });
      const state = createMockState([oldChunk, newChunk]);

      const result = mgr.checkTokenUsage(state);

      expect(result.needsTruncation).toBe(true);
      expect(result.chunksToTruncate.length).toBeGreaterThan(0);
      // Oldest chunks should be selected first
      expect(result.chunksToTruncate[0]).toBe('old-chunk');
    });

    it('should not count non-conversation chunks as compressible', () => {
      const systemChunk = createMockChunk('sys-1', {
        type: ChunkType.SYSTEM,
        content: { type: ChunkContentType.TEXT, text: 'System content' },
      });
      const workingChunk = createMockChunk('work-1', {
        type: ChunkType.THINKING,
        content: { type: ChunkContentType.TEXT, text: 'Working content' },
      });
      const state = createMockState([systemChunk, workingChunk]);

      const result = manager.checkTokenUsage(state);

      // Total should include both, but compressible should only include conversation chunks
      expect(result.chunksToCompact).toHaveLength(1);
      expect(result.chunksToCompact[0].id).toBe('work-1');
    });

    it('should not include CRITICAL retention chunks in compressible', () => {
      const criticalChunk = createMockChunk('critical-1', {
        type: ChunkType.THINKING,
        retentionStrategy: ChunkRetentionStrategy.CRITICAL,
        content: { type: ChunkContentType.TEXT, text: 'Critical content' },
      });
      const compressibleChunk = createMockChunk('compressible-1', {
        type: ChunkType.THINKING,
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
        content: { type: ChunkContentType.TEXT, text: 'Compressible content' },
      });
      const state = createMockState([criticalChunk, compressibleChunk]);

      const result = manager.checkTokenUsage(state);

      expect(result.chunksToCompact).toHaveLength(1);
      expect(result.chunksToCompact[0].id).toBe('compressible-1');
    });
  });

  describe('executeCompaction', () => {
    let mockMemoryManager: jest.Mocked<IMemoryManager>;
    let mockStateTransitionManager: jest.Mocked<IStateTransitionManager>;
    let mockObserverManager: jest.Mocked<ObserverManager>;
    let mockComponent: Partial<IComponent>;
    let componentLookup: ComponentLookup;

    const mockThread = {
      id: 'thread-1',
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      currentStateId: 'state-1',
      initialStateId: 'state-1',
    };

    beforeEach(() => {
      mockMemoryManager = {
        getCurrentState: jest.fn(),
      } as unknown as jest.Mocked<IMemoryManager>;

      mockStateTransitionManager = {
        applyReducerResult: jest.fn(),
      } as unknown as jest.Mocked<IStateTransitionManager>;

      mockObserverManager = {
        notifyCompactionStart: jest.fn(),
        notifyCompactionEnd: jest.fn(),
      } as unknown as jest.Mocked<ObserverManager>;

      // Create mock component with compactChunk that uses the test's llmAdapter
      mockComponent = {
        id: 'working-history',
        name: 'Working History',
        type: 'base',
        compactChunk: async (
          _chunk: MemoryChunk,
          state: MemoryState,
          adapter: ILLMAdapter,
          config?: ComponentCompactionConfig,
        ) => {
          const result = await compactWorkingHistory(state, adapter, config);
          return {
            ...result,
            componentKey: 'working-history',
          };
        },
      };
      componentLookup = createMockComponentLookup(mockComponent);
    });

    it('should throw error when state not found', async () => {
      mockMemoryManager.getCurrentState.mockResolvedValue(null);

      await expect(
        manager.executeCompaction(
          'thread-1',
          mockMemoryManager,
          mockStateTransitionManager,
          mockObserverManager,
        ),
      ).rejects.toThrow('Current state not found for thread: thread-1');
    });

    it('should throw error when no WORKING_HISTORY chunk found', async () => {
      const state = createMockState([]);
      mockMemoryManager.getCurrentState.mockResolvedValue(state);

      await expect(
        manager.executeCompaction(
          'thread-1',
          mockMemoryManager,
          mockStateTransitionManager,
          mockObserverManager,
        ),
      ).rejects.toThrow('No chunks available for compaction');
    });

    it('should throw error when no compressible chunks in WORKING_HISTORY', async () => {
      // Create state with WORKING_HISTORY but only CRITICAL chunks
      const criticalChunk = createMockChunk('critical-1', {
        type: ChunkType.THINKING,
        retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      });
      const state = createStateWithWorkingHistory([criticalChunk]);
      mockMemoryManager.getCurrentState.mockResolvedValue(state);

      await expect(
        manager.executeCompaction(
          'thread-1',
          mockMemoryManager,
          mockStateTransitionManager,
          mockObserverManager,
        ),
      ).rejects.toThrow('No chunks available for compaction');
    });

    it('should notify observers on compaction start and end', async () => {
      const chunk1 = createMockChunk('c1', {
        type: ChunkType.THINKING,
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });
      const chunk2 = createMockChunk('c2', {
        type: ChunkType.AGENT_RESPONSE,
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });
      const state = createStateWithWorkingHistory([chunk1, chunk2]);

      mockMemoryManager.getCurrentState.mockResolvedValue(state);
      mockStateTransitionManager.applyReducerResult.mockResolvedValue({
        thread: mockThread,
        state,
        addedChunks: [],
        removedChunkIds: ['c1', 'c2'],
      });

      await manager.executeCompaction(
        'thread-1',
        mockMemoryManager,
        mockStateTransitionManager,
        mockObserverManager,
        componentLookup,
      );

      expect(mockObserverManager.notifyCompactionStart).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 'thread-1',
        }),
      );

      expect(mockObserverManager.notifyCompactionEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 'thread-1',
          originalChunkIds: ['c1', 'c2'],
        }),
      );
    });

    it('should apply compaction result through state transition manager', async () => {
      const chunk1 = createMockChunk('c1', {
        type: ChunkType.THINKING,
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
        content: { type: ChunkContentType.TEXT, text: 'Some content' },
      });
      const state = createStateWithWorkingHistory([chunk1]);

      mockMemoryManager.getCurrentState.mockResolvedValue(state);
      mockStateTransitionManager.applyReducerResult.mockResolvedValue({
        thread: mockThread,
        state,
        addedChunks: [],
        removedChunkIds: ['c1'],
      });

      await manager.executeCompaction(
        'thread-1',
        mockMemoryManager,
        mockStateTransitionManager,
        mockObserverManager,
        componentLookup,
      );

      expect(
        mockStateTransitionManager.applyReducerResult,
      ).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({
          operations: expect.arrayContaining([
            expect.objectContaining({
              type: 'BATCH_REPLACE',
            }),
          ]),
          chunks: expect.arrayContaining([
            expect.objectContaining({
              type: ChunkType.COMPACTED,
            }),
          ]),
        }),
      );
    });

    it('should call LLM adapter with correct prompt', async () => {
      const chunk1 = createMockChunk('c1', {
        type: ChunkType.USER_MESSAGE,
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
        content: { type: ChunkContentType.TEXT, text: 'User message content' },
      });
      const state = createStateWithWorkingHistory([chunk1]);

      mockMemoryManager.getCurrentState.mockResolvedValue(state);
      mockStateTransitionManager.applyReducerResult.mockResolvedValue({
        thread: mockThread,
        state,
        addedChunks: [],
        removedChunkIds: ['c1'],
      });

      await manager.executeCompaction(
        'thread-1',
        mockMemoryManager,
        mockStateTransitionManager,
        mockObserverManager,
        componentLookup,
      );

      expect(llmAdapter.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining('User message content'),
            }),
          ]),
        }),
      );
    });

    it('should include retained content in prompt when CRITICAL chunks exist', async () => {
      const criticalChunk = createMockChunk('critical-1', {
        type: ChunkType.USER_MESSAGE,
        retentionStrategy: ChunkRetentionStrategy.CRITICAL,
        content: {
          type: ChunkContentType.TEXT,
          text: 'Critical information',
        },
      });
      const compressibleChunk = createMockChunk('c1', {
        type: ChunkType.AGENT_RESPONSE,
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
        content: { type: ChunkContentType.TEXT, text: 'Response content' },
      });

      // Add both to state but only compressible to WORKING_HISTORY childIds
      const workingHistoryChunk = createMockChunk('working-history-1', {
        type: ChunkType.WORKING_HISTORY,
        content: { type: ChunkContentType.TEXT, text: '' },
        childIds: [compressibleChunk.id],
      });

      const chunkMap = new Map<string, MemoryChunk>();
      chunkMap.set(workingHistoryChunk.id, workingHistoryChunk);
      chunkMap.set(criticalChunk.id, criticalChunk);
      chunkMap.set(compressibleChunk.id, compressibleChunk);

      const state: MemoryState = {
        id: 'state-1',
        threadId: 'thread-1',
        chunkIds: [
          workingHistoryChunk.id,
          criticalChunk.id,
          compressibleChunk.id,
        ],
        chunks: chunkMap,
        metadata: { createdAt: Date.now() },
      };

      mockMemoryManager.getCurrentState.mockResolvedValue(state);
      mockStateTransitionManager.applyReducerResult.mockResolvedValue({
        thread: mockThread,
        state,
        addedChunks: [],
        removedChunkIds: ['c1'],
      });

      await manager.executeCompaction(
        'thread-1',
        mockMemoryManager,
        mockStateTransitionManager,
        mockObserverManager,
        componentLookup,
      );

      // Verify that LLM was called with a prompt containing retained content section
      expect(llmAdapter.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining('Critical information'),
            }),
          ]),
        }),
      );
    });
  });
});
