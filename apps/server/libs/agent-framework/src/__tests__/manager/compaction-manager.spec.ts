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
import {
  ICompactor,
  CompactionResult,
} from '../../compactor/compactor.types.js';
import type { ILLMAdapter } from '../../llm/llm.types.js';
import type { ThreadManager } from '../../manager/thread.manager.js';
import type { ObserverManager } from '../../observer/observer.types.js';

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
  },
): MemoryChunk => ({
  id,
  type: options?.type ?? ChunkType.WORKING_FLOW,
  content: options?.content ?? {
    type: ChunkContentType.TEXT,
    text: 'test content',
  },
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

    it('should return WORKING_FLOW chunks with COMPRESSIBLE retention', () => {
      const compressibleChunk = createMockChunk('c1', {
        type: ChunkType.WORKING_FLOW,
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });
      const criticalChunk = createMockChunk('c2', {
        type: ChunkType.WORKING_FLOW,
        retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      });
      const state = createMockState([compressibleChunk, criticalChunk]);

      const result = manager.getCompressibleChunks(state);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('c1');
    });

    it('should return BATCH_COMPRESSIBLE chunks', () => {
      const chunk = createMockChunk('c1', {
        type: ChunkType.WORKING_FLOW,
        retentionStrategy: ChunkRetentionStrategy.BATCH_COMPRESSIBLE,
      });
      const state = createMockState([chunk]);

      const result = manager.getCompressibleChunks(state);

      expect(result).toHaveLength(1);
    });

    it('should return DISPOSABLE chunks', () => {
      const chunk = createMockChunk('c1', {
        type: ChunkType.WORKING_FLOW,
        retentionStrategy: ChunkRetentionStrategy.DISPOSABLE,
      });
      const state = createMockState([chunk]);

      const result = manager.getCompressibleChunks(state);

      expect(result).toHaveLength(1);
    });

    it('should not return non-WORKING_FLOW chunks', () => {
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

    it('should not count non-WORKING_FLOW chunks as compressible', () => {
      const systemChunk = createMockChunk('sys-1', {
        type: ChunkType.SYSTEM,
        content: { type: ChunkContentType.TEXT, text: 'System content' },
      });
      const workingChunk = createMockChunk('work-1', {
        type: ChunkType.WORKING_FLOW,
        content: { type: ChunkContentType.TEXT, text: 'Working content' },
      });
      const state = createMockState([systemChunk, workingChunk]);

      const result = manager.checkTokenUsage(state);

      // Total should include both, but compressible should only include WORKING_FLOW
      expect(result.chunksToCompact).toHaveLength(1);
      expect(result.chunksToCompact[0].id).toBe('work-1');
    });

    it('should not include CRITICAL retention chunks in compressible', () => {
      const criticalChunk = createMockChunk('critical-1', {
        type: ChunkType.WORKING_FLOW,
        retentionStrategy: ChunkRetentionStrategy.CRITICAL,
        content: { type: ChunkContentType.TEXT, text: 'Critical content' },
      });
      const compressibleChunk = createMockChunk('compressible-1', {
        type: ChunkType.WORKING_FLOW,
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
        content: { type: ChunkContentType.TEXT, text: 'Compressible content' },
      });
      const state = createMockState([criticalChunk, compressibleChunk]);

      const result = manager.checkTokenUsage(state);

      expect(result.chunksToCompact).toHaveLength(1);
      expect(result.chunksToCompact[0].id).toBe('compressible-1');
    });
  });

  describe('registerCompactor', () => {
    it('should register custom compactor', () => {
      const customCompactor: ICompactor = {
        canCompact: jest.fn().mockReturnValue(true),
        compact: jest.fn(),
      };

      manager.registerCompactor(customCompactor);

      // The custom compactor should now be available
      // We can verify by checking canCompact is called when appropriate
      expect(customCompactor.canCompact).not.toHaveBeenCalled();
    });
  });

  describe('executeCompaction', () => {
    let mockThreadManager: jest.Mocked<ThreadManager>;
    let mockObserverManager: jest.Mocked<ObserverManager>;

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
      mockThreadManager = {
        getCurrentState: jest.fn(),
        getThread: jest.fn(),
        applyReducerResult: jest.fn(),
      } as unknown as jest.Mocked<ThreadManager>;

      mockObserverManager = {
        notifyCompactionStart: jest.fn(),
        notifyCompactionEnd: jest.fn(),
      } as unknown as jest.Mocked<ObserverManager>;
    });

    it('should throw error when state not found', async () => {
      mockThreadManager.getCurrentState.mockResolvedValue(null);

      await expect(
        manager.executeCompaction(
          'thread-1',
          [createMockChunk('c1')],
          mockThreadManager,
          mockObserverManager,
        ),
      ).rejects.toThrow('Current state not found for thread: thread-1');
    });

    it('should return current state when no chunks to compact', async () => {
      const state = createMockState([]);
      mockThreadManager.getCurrentState.mockResolvedValue(state);
      mockThreadManager.getThread.mockResolvedValue(mockThread);

      const result = await manager.executeCompaction(
        'thread-1',
        [],
        mockThreadManager,
        mockObserverManager,
      );

      expect(result.state).toBe(state);
      expect(result.addedChunks).toEqual([]);
      expect(result.removedChunkIds).toEqual([]);
      expect(mockObserverManager.notifyCompactionStart).not.toHaveBeenCalled();
    });

    it('should throw error when thread not found (empty chunks case)', async () => {
      const state = createMockState([]);
      mockThreadManager.getCurrentState.mockResolvedValue(state);
      mockThreadManager.getThread.mockResolvedValue(null);

      await expect(
        manager.executeCompaction(
          'thread-1',
          [],
          mockThreadManager,
          mockObserverManager,
        ),
      ).rejects.toThrow('Thread not found: thread-1');
    });

    it('should notify observers on compaction start and end', async () => {
      const chunks = [createMockChunk('c1'), createMockChunk('c2')];
      const state = createMockState(chunks);
      const compactedChunk = createMockChunk('compacted-1', {
        custom: { subType: 'COMPACTED' },
      });

      mockThreadManager.getCurrentState.mockResolvedValue(state);
      mockThreadManager.applyReducerResult.mockResolvedValue({
        thread: mockThread,
        state,
        addedChunks: [compactedChunk],
        removedChunkIds: ['c1', 'c2'],
      });

      // Replace all compactors with our mock
      const mockCompactor: ICompactor = {
        canCompact: jest.fn().mockReturnValue(true),
        compact: jest.fn().mockResolvedValue({
          compactedChunk,
          originalChunkIds: ['c1', 'c2'],
          tokensBefore: 200,
          tokensAfter: 50,
        } as CompactionResult),
      };
      (manager as any).compactors = [mockCompactor];

      await manager.executeCompaction(
        'thread-1',
        chunks,
        mockThreadManager,
        mockObserverManager,
      );

      expect(mockObserverManager.notifyCompactionStart).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 'thread-1',
          chunkCount: 2,
          chunkIds: ['c1', 'c2'],
        }),
      );

      expect(mockObserverManager.notifyCompactionEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 'thread-1',
          tokensBefore: 200,
          tokensAfter: 50,
          compactedChunkId: 'compacted-1',
          originalChunkIds: ['c1', 'c2'],
        }),
      );
    });

    it('should throw error when no suitable compactor found', async () => {
      const chunks = [createMockChunk('c1')];
      const state = createMockState(chunks);
      mockThreadManager.getCurrentState.mockResolvedValue(state);

      // Create manager without default compactor handling these chunks
      const customMgr = new CompactionManager(llmAdapter, config);
      // Clear default compactors by registering one that rejects all
      const rejectingCompactor: ICompactor = {
        canCompact: jest.fn().mockReturnValue(false),
        compact: jest.fn(),
      };
      // Override internal compactors - need to make them all reject
      (customMgr as any).compactors = [rejectingCompactor];

      await expect(
        customMgr.executeCompaction(
          'thread-1',
          chunks,
          mockThreadManager,
          mockObserverManager,
        ),
      ).rejects.toThrow('No suitable compactor found for chunks');
    });

    it('should apply compaction result through thread manager', async () => {
      const chunks = [createMockChunk('c1')];
      const state = createMockState(chunks);
      const compactedChunk = createMockChunk('compacted-1');

      mockThreadManager.getCurrentState.mockResolvedValue(state);
      mockThreadManager.applyReducerResult.mockResolvedValue({
        thread: mockThread,
        state,
        addedChunks: [compactedChunk],
        removedChunkIds: ['c1'],
      });

      // Replace all compactors with our mock
      const mockCompactor: ICompactor = {
        canCompact: jest.fn().mockReturnValue(true),
        compact: jest.fn().mockResolvedValue({
          compactedChunk,
          originalChunkIds: ['c1'],
          tokensBefore: 100,
          tokensAfter: 50,
        } as CompactionResult),
      };
      (manager as any).compactors = [mockCompactor];

      await manager.executeCompaction(
        'thread-1',
        chunks,
        mockThreadManager,
        mockObserverManager,
      );

      expect(mockThreadManager.applyReducerResult).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({
          operations: expect.arrayContaining([
            expect.objectContaining({
              type: 'BATCH_REPLACE',
            }),
          ]),
          chunks: [compactedChunk],
        }),
      );
    });
  });

  describe('extractTaskGoal (via executeCompaction context)', () => {
    // This tests the private extractTaskGoal method through its usage
    it('should extract task from SYSTEM chunk', async () => {
      const systemChunk = createMockChunk('sys-1', {
        type: ChunkType.SYSTEM,
        content: {
          type: ChunkContentType.TEXT,
          text: '',
          task: 'Complete the analysis',
        },
      });
      const workingChunk = createMockChunk('c1');
      const state = createMockState([systemChunk, workingChunk]);

      const mockThreadManager = {
        getCurrentState: jest.fn().mockResolvedValue(state),
        applyReducerResult: jest.fn().mockResolvedValue({
          thread: { id: 'thread-1' },
          state,
          addedChunks: [],
          removedChunkIds: [],
        }),
      } as unknown as jest.Mocked<ThreadManager>;

      const mockObserverManager = {
        notifyCompactionStart: jest.fn(),
        notifyCompactionEnd: jest.fn(),
      } as unknown as jest.Mocked<ObserverManager>;

      let capturedContext: any = null;
      const mockCompactor: ICompactor = {
        canCompact: jest.fn().mockReturnValue(true),
        compact: jest.fn().mockImplementation((chunks, context) => {
          capturedContext = context;
          return Promise.resolve({
            compactedChunk: createMockChunk('compacted-1'),
            originalChunkIds: chunks.map((c: MemoryChunk) => c.id),
          });
        }),
      };
      // Replace all compactors with our mock
      (manager as any).compactors = [mockCompactor];

      await manager.executeCompaction(
        'thread-1',
        [workingChunk],
        mockThreadManager,
        mockObserverManager,
      );

      expect(capturedContext.taskGoal).toBe('Complete the analysis');
    });
  });

  describe('extractProgressSummary (via executeCompaction context)', () => {
    it('should extract progress from COMPACTED chunk', async () => {
      const compactedChunk = createMockChunk('compacted-old', {
        type: ChunkType.WORKING_FLOW,
        content: {
          type: ChunkContentType.TEXT,
          text: 'Previous progress summary',
        },
        custom: { subType: 'COMPACTED' },
      });
      const workingChunk = createMockChunk('c1');
      const state = createMockState([compactedChunk, workingChunk]);

      const mockThreadManager = {
        getCurrentState: jest.fn().mockResolvedValue(state),
        applyReducerResult: jest.fn().mockResolvedValue({
          thread: { id: 'thread-1' },
          state,
          addedChunks: [],
          removedChunkIds: [],
        }),
      } as unknown as jest.Mocked<ThreadManager>;

      const mockObserverManager = {
        notifyCompactionStart: jest.fn(),
        notifyCompactionEnd: jest.fn(),
      } as unknown as jest.Mocked<ObserverManager>;

      let capturedContext: any = null;
      const mockCompactor: ICompactor = {
        canCompact: jest.fn().mockReturnValue(true),
        compact: jest.fn().mockImplementation((chunks, context) => {
          capturedContext = context;
          return Promise.resolve({
            compactedChunk: createMockChunk('compacted-1'),
            originalChunkIds: chunks.map((c: MemoryChunk) => c.id),
          });
        }),
      };
      // Replace all compactors with our mock
      (manager as any).compactors = [mockCompactor];

      await manager.executeCompaction(
        'thread-1',
        [workingChunk],
        mockThreadManager,
        mockObserverManager,
      );

      expect(capturedContext.progressSummary).toBe('Previous progress summary');
    });
  });
});
