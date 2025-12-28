/**
 * Unit tests for EventProcessor
 */
import {
  EventProcessor,
  DispatchResult,
} from '../../manager/event-processor.js';
import { ThreadManager } from '../../manager/thread.manager.js';
import { CompactionManager } from '../../manager/compaction.manager.js';
import { ExecutionModeController } from '../../manager/execution-mode.controller.js';
import { ReducerRegistry, ReducerResult } from '../../reducer/reducer.types.js';
import type { ObserverManager } from '../../observer/observer.types.js';
import { InMemoryStorageProvider } from '../../storage/memory.storage.js';
import { EventType, AgentEvent } from '../../types/index.js';
import {
  MemoryChunk,
  ChunkType,
  ChunkRetentionStrategy,
  ChunkContentType,
} from '../../types/chunk.types.js';
import {
  OperationType,
  Operation,
  AddOperation,
  DeleteOperation,
} from '../../types/operation.types.js';
import type {
  ILLMAdapter,
  LLMCompletionResponse,
} from '../../llm/llm.types.js';
import { generateOperationId } from '../../utils/id.utils.js';

// Mock LLM adapter
const createMockLLMAdapter = (): ILLMAdapter => ({
  complete: jest.fn().mockResolvedValue({
    content: 'Compacted content',
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  } as LLMCompletionResponse),
});

// Mock observer manager
const createMockObserverManager = (): ObserverManager => ({
  addObserver: jest.fn().mockReturnValue(() => {}),
  removeObserver: jest.fn(),
  notifyEventDispatch: jest.fn(),
  notifyReducerExecute: jest.fn(),
  notifyStateChange: jest.fn(),
  notifyCompactionStart: jest.fn(),
  notifyCompactionEnd: jest.fn(),
  notifyError: jest.fn(),
  notifySubAgentSpawn: jest.fn(),
  notifySubAgentResult: jest.fn(),
  notifyEventQueued: jest.fn(),
  notifyEventDequeued: jest.fn(),
});

// Mock reducer registry
const createMockReducerRegistry = (): ReducerRegistry => ({
  register: jest.fn(),
  unregister: jest.fn(),
  getReducersForEvent: jest.fn().mockReturnValue([]),
  reduce: jest.fn().mockResolvedValue({
    operations: [],
    chunks: [],
  } as ReducerResult),
});

// Create a mock chunk
const createMockChunk = (
  id: string,
  overrides?: Partial<MemoryChunk>,
): MemoryChunk => ({
  id,
  type: ChunkType.WORKING_FLOW,
  content: { type: ChunkContentType.TEXT, text: 'test content' },
  retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
  mutable: false,
  priority: 0,
  metadata: {
    createdAt: Date.now(),
  },
  ...overrides,
});

// Helper to create an ADD operation
const createAddOperation = (chunkId: string): AddOperation => ({
  id: generateOperationId(),
  type: OperationType.ADD,
  chunkId,
  timestamp: Date.now(),
});

// Helper to create a DELETE operation
const createDeleteOperation = (chunkId: string): DeleteOperation => ({
  id: generateOperationId(),
  type: OperationType.DELETE,
  chunkId,
  timestamp: Date.now(),
});

describe('EventProcessor', () => {
  let storage: InMemoryStorageProvider;
  let threadManager: ThreadManager;
  let reducerRegistry: ReducerRegistry;
  let observerManager: ObserverManager;
  let compactionManager: CompactionManager;
  let executionModeController: ExecutionModeController;
  let eventProcessor: EventProcessor;
  let mockLLMAdapter: ILLMAdapter;

  beforeEach(async () => {
    storage = new InMemoryStorageProvider();
    threadManager = new ThreadManager(storage);
    reducerRegistry = createMockReducerRegistry();
    observerManager = createMockObserverManager();
    mockLLMAdapter = createMockLLMAdapter();
    compactionManager = new CompactionManager(mockLLMAdapter, {
      llm: { model: 'gpt-4' },
      autoCompactEnabled: true,
      // Very low token thresholds for testing
      tokenThresholds: {
        softThreshold: 20,
        hardThreshold: 50,
        truncationThreshold: 100,
      },
    });
    executionModeController = new ExecutionModeController();

    eventProcessor = new EventProcessor(
      threadManager,
      reducerRegistry,
      observerManager,
      compactionManager,
      executionModeController,
    );
  });

  describe('processEvent', () => {
    it('should throw error for non-existent thread', async () => {
      const event: AgentEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Hello',
      };

      await expect(
        eventProcessor.processEvent('non-existent', event),
      ).rejects.toThrow('Current state not found for thread: non-existent');
    });

    it('should notify observers of event dispatch', async () => {
      const { thread } = await threadManager.createThread();
      const event: AgentEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Hello',
      };

      await eventProcessor.processEvent(thread.id, event);

      expect(observerManager.notifyEventDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: thread.id,
          event,
          timestamp: expect.any(Number),
        }),
      );
    });

    it('should notify observers of reducer execution', async () => {
      const { thread, initialState } = await threadManager.createThread();
      const event: AgentEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Hello',
      };

      await eventProcessor.processEvent(thread.id, event);

      expect(observerManager.notifyReducerExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: thread.id,
          reducerName: 'ReducerRegistry',
          inputEvent: event,
          inputState: initialState,
          result: expect.any(Object),
          logs: [],
          duration: expect.any(Number),
        }),
      );
    });

    it('should return unchanged state when reducer produces no operations', async () => {
      const { thread, initialState } = await threadManager.createThread();

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations: [],
        chunks: [],
      });

      const event: AgentEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Hello',
      };

      const result = await eventProcessor.processEvent(thread.id, event);

      expect(result.thread.id).toBe(thread.id);
      expect(result.state.id).toBe(initialState.id);
      expect(result.addedChunks).toEqual([]);
      expect(result.removedChunkIds).toEqual([]);
    });

    it('should apply reducer operations and notify state change', async () => {
      const { thread, initialState } = await threadManager.createThread();
      const newChunk = createMockChunk('chunk-1');

      const addOperation = createAddOperation(newChunk.id);

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations: [addOperation],
        chunks: [newChunk],
      });

      const event: AgentEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Hello',
      };

      const result = await eventProcessor.processEvent(thread.id, event);

      expect(result.addedChunks).toHaveLength(1);
      expect(result.addedChunks[0].id).toBe('chunk-1');
      expect(observerManager.notifyStateChange).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: thread.id,
          previousState: initialState,
          newState: result.state,
          triggerEvent: event,
          reducerName: 'ReducerRegistry',
          operations: [addOperation],
          addedChunks: result.addedChunks,
          removedChunkIds: result.removedChunkIds,
        }),
      );
    });

    it('should queue compaction when token threshold reached in non-stepping mode', async () => {
      const { thread } = await threadManager.createThread();

      // Create chunks with enough content to exceed hard threshold (50 tokens)
      // Each chunk has ~15 tokens, so 4-5 chunks should exceed threshold
      const chunks: MemoryChunk[] = [];
      const operations: AddOperation[] = [];
      for (let i = 0; i < 5; i++) {
        const chunk = createMockChunk(`chunk-${i}`, {
          content: {
            type: ChunkContentType.TEXT,
            text: 'This is a test message with enough words to generate some tokens for testing purposes in this chunk.',
          },
        });
        chunks.push(chunk);
        operations.push(createAddOperation(chunk.id));
      }

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations,
        chunks,
      });

      const event: AgentEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Hello',
      };

      await eventProcessor.processEvent(thread.id, event, {
        steppingMode: false,
      });

      // Compaction should be queued as pending when hard threshold is exceeded
      expect(executionModeController.hasPendingCompaction(thread.id)).toBe(
        true,
      );
    });

    it('should queue compaction for next step in stepping mode', async () => {
      const { thread } = await threadManager.createThread();

      // Create chunks with enough content to exceed hard threshold (50 tokens)
      const chunks: MemoryChunk[] = [];
      const operations: AddOperation[] = [];
      for (let i = 0; i < 5; i++) {
        const chunk = createMockChunk(`chunk-${i}`, {
          content: {
            type: ChunkContentType.TEXT,
            text: 'This is a test message with enough words to generate some tokens for testing purposes in this chunk.',
          },
        });
        chunks.push(chunk);
        operations.push(createAddOperation(chunk.id));
      }

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations,
        chunks,
      });

      const event: AgentEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Hello',
      };

      await eventProcessor.processEvent(thread.id, event, {
        steppingMode: true,
      });

      // Compaction should be pending
      expect(executionModeController.hasPendingCompaction(thread.id)).toBe(
        true,
      );
    });

    it('should queue truncation when truncation threshold reached', async () => {
      const { thread } = await threadManager.createThread();

      // Create chunks with enough content to exceed truncation threshold (100 tokens)
      const chunks: MemoryChunk[] = [];
      const operations: AddOperation[] = [];
      for (let i = 0; i < 8; i++) {
        const chunk = createMockChunk(`chunk-${i}`, {
          content: {
            type: ChunkContentType.TEXT,
            text: 'This is a test message with enough words to generate some tokens for testing purposes in this chunk.',
          },
        });
        chunks.push(chunk);
        operations.push(createAddOperation(chunk.id));
      }

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations,
        chunks,
      });

      const event: AgentEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Hello',
      };

      await eventProcessor.processEvent(thread.id, event, {
        steppingMode: false,
      });

      // Truncation should be pending when truncation threshold is exceeded
      expect(executionModeController.hasPendingTruncation(thread.id)).toBe(
        true,
      );
    });
  });

  describe('consumePendingCompaction', () => {
    it('should return null when no pending compaction', async () => {
      const { thread } = await threadManager.createThread();

      const result = eventProcessor.consumePendingCompaction(thread.id);

      expect(result).toBeNull();
    });

    it('should consume and return pending compaction chunks', async () => {
      const { thread } = await threadManager.createThread();
      const chunks = [createMockChunk('chunk-1'), createMockChunk('chunk-2')];

      executionModeController.setPendingCompaction(thread.id, chunks);

      const result = eventProcessor.consumePendingCompaction(thread.id);

      expect(result).toEqual(chunks);
      expect(eventProcessor.consumePendingCompaction(thread.id)).toBeNull();
    });
  });

  describe('consumePendingTruncation', () => {
    it('should return null when no pending truncation', async () => {
      const { thread } = await threadManager.createThread();

      const result = eventProcessor.consumePendingTruncation(thread.id);

      expect(result).toBeNull();
    });

    it('should consume and return pending truncation chunk IDs', async () => {
      const { thread } = await threadManager.createThread();
      const chunkIds = ['chunk-1', 'chunk-2'];

      executionModeController.setPendingTruncation(thread.id, chunkIds);

      const result = eventProcessor.consumePendingTruncation(thread.id);

      expect(result).toEqual(chunkIds);
      expect(eventProcessor.consumePendingTruncation(thread.id)).toBeNull();
    });
  });

  describe('dispatch strategy flags', () => {
    it('should set shouldTerminate for terminate-type events', async () => {
      const { thread } = await threadManager.createThread();
      const newChunk = createMockChunk('chunk-1');
      const addOperation = createAddOperation(newChunk.id);

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations: [addOperation],
        chunks: [newChunk],
      });

      // TASK_COMPLETED is a terminate-type event by default
      const event: AgentEvent = {
        type: EventType.TASK_COMPLETED,
        timestamp: Date.now(),
        result: 'Task completed successfully',
      };

      const result = await eventProcessor.processEvent(thread.id, event);

      expect(result.shouldTerminate).toBe(true);
      expect(result.shouldInterrupt).toBe(false);
      expect(result.dispatchStrategy).toBe('terminate');
    });

    it('should set shouldTerminate for TASK_ABANDONED events', async () => {
      const { thread } = await threadManager.createThread();

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations: [],
        chunks: [],
      });

      const event: AgentEvent = {
        type: EventType.TASK_ABANDONED,
        timestamp: Date.now(),
        reason: 'User cancelled',
      };

      const result = await eventProcessor.processEvent(thread.id, event);

      expect(result.shouldTerminate).toBe(true);
      expect(result.dispatchStrategy).toBe('terminate');
    });

    it('should set shouldTerminate for TASK_TERMINATED events', async () => {
      const { thread } = await threadManager.createThread();

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations: [],
        chunks: [],
      });

      const event: AgentEvent = {
        type: EventType.TASK_TERMINATED,
        timestamp: Date.now(),
        terminatedBy: 'user',
        reason: 'Force stop',
      };

      const result = await eventProcessor.processEvent(thread.id, event);

      expect(result.shouldTerminate).toBe(true);
      expect(result.dispatchStrategy).toBe('terminate');
    });

    it('should not set shouldTerminate for queue-type events', async () => {
      const { thread } = await threadManager.createThread();

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations: [],
        chunks: [],
      });

      const event: AgentEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Hello',
      };

      const result = await eventProcessor.processEvent(thread.id, event);

      expect(result.shouldTerminate).toBe(false);
      expect(result.shouldInterrupt).toBe(false);
      expect(result.dispatchStrategy).toBe('queue');
    });

    it('should respect explicit dispatchStrategy override', async () => {
      const { thread } = await threadManager.createThread();

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations: [],
        chunks: [],
      });

      // USER_MESSAGE normally has 'queue' strategy, but we override to 'interrupt'
      const event: AgentEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Urgent message',
        dispatchStrategy: 'interrupt',
      };

      const result = await eventProcessor.processEvent(thread.id, event);

      expect(result.shouldInterrupt).toBe(true);
      expect(result.shouldTerminate).toBe(false);
      expect(result.dispatchStrategy).toBe('interrupt');
    });

    it('should allow overriding terminate event to queue', async () => {
      const { thread } = await threadManager.createThread();

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations: [],
        chunks: [],
      });

      // TASK_COMPLETED normally terminates, but we override to 'queue'
      const event: AgentEvent = {
        type: EventType.TASK_COMPLETED,
        timestamp: Date.now(),
        result: 'Partial result',
        dispatchStrategy: 'queue',
      };

      const result = await eventProcessor.processEvent(thread.id, event);

      expect(result.shouldTerminate).toBe(false);
      expect(result.shouldInterrupt).toBe(false);
      expect(result.dispatchStrategy).toBe('queue');
    });
  });

  describe('edge cases', () => {
    it('should handle empty content in event', async () => {
      const { thread } = await threadManager.createThread();
      const event: AgentEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: '',
      };

      const result = await eventProcessor.processEvent(thread.id, event);

      expect(result).toBeDefined();
      expect(observerManager.notifyEventDispatch).toHaveBeenCalled();
    });

    it('should handle DELETE operations', async () => {
      // Create thread with initial chunk
      const initialChunk = createMockChunk('initial-chunk');
      const { thread } = await threadManager.createThread({
        initialChunks: [initialChunk],
      });

      const deleteOperation = createDeleteOperation('initial-chunk');

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations: [deleteOperation],
        chunks: [],
      });

      const event: AgentEvent = {
        type: EventType.MEMORY_FORGET,
        timestamp: Date.now(),
        chunkIds: ['initial-chunk'],
      };

      const result = await eventProcessor.processEvent(thread.id, event);

      expect(result.removedChunkIds).toContain('initial-chunk');
    });

    it('should work with multiple sequential events', async () => {
      const { thread } = await threadManager.createThread();

      // First event adds chunk-1
      const chunk1 = createMockChunk('chunk-1');
      (reducerRegistry.reduce as jest.Mock).mockResolvedValueOnce({
        operations: [createAddOperation(chunk1.id)],
        chunks: [chunk1],
      });

      const event1: AgentEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'First',
      };

      const result1 = await eventProcessor.processEvent(thread.id, event1);
      expect(result1.addedChunks).toHaveLength(1);
      expect(result1.state.chunkIds).toHaveLength(1);
      expect(result1.state.chunkIds).toContain('chunk-1');

      // Second event adds chunk-2
      const chunk2 = createMockChunk('chunk-2');
      (reducerRegistry.reduce as jest.Mock).mockResolvedValueOnce({
        operations: [createAddOperation(chunk2.id)],
        chunks: [chunk2],
      });

      const event2: AgentEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Second',
      };

      const result2 = await eventProcessor.processEvent(thread.id, event2);
      expect(result2.addedChunks).toHaveLength(1);
      // The state should now contain both chunks from both operations
      expect(result2.state.chunkIds).toContain('chunk-2');
    });
  });
});
