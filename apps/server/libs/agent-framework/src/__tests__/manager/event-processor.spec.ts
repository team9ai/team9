/**
 * Unit tests for EventProcessor
 */
import {
  EventProcessor,
  CompactionCheckResult,
} from '../../manager/event-processor.js';
import { MemoryManagerImpl } from '../../manager/memory-manager.impl.js';
import type { IMemoryManager } from '../../manager/memory-manager.interface.js';
import { CompactionManager } from '../../manager/compaction.manager.js';
import { StepLockManager } from '../../manager/step-lock.manager.js';
import { StepLifecycleManager } from '../../manager/step-lifecycle.manager.js';
import { StateTransitionManager } from '../../manager/state-transition.manager.js';
import { ReducerRegistry, ReducerResult } from '../../reducer/reducer.types.js';
import type { ObserverManager } from '../../observer/observer.types.js';
import { InMemoryStorageProvider } from '../../storage/memory.storage.js';
import {
  EventType,
  EventDispatchStrategy,
  BaseEvent,
} from '../../types/index.js';
import {
  MemoryChunk,
  ChunkType,
  ChunkRetentionStrategy,
  ChunkContentType,
} from '../../types/chunk.types.js';
import {
  OperationType,
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
  type: ChunkType.THINKING,
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
  let memoryManager: IMemoryManager;
  let stateTransitionManager: StateTransitionManager;
  let stepLockManager: StepLockManager;
  let stepLifecycleManager: StepLifecycleManager;
  let reducerRegistry: ReducerRegistry;
  let observerManager: ObserverManager;
  let compactionManager: CompactionManager;
  let eventProcessor: EventProcessor;
  let mockLLMAdapter: ILLMAdapter;

  beforeEach(async () => {
    storage = new InMemoryStorageProvider();
    memoryManager = new MemoryManagerImpl(storage);
    stateTransitionManager = new StateTransitionManager(memoryManager);
    stepLockManager = new StepLockManager(memoryManager);
    stepLifecycleManager = new StepLifecycleManager(memoryManager);
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

    eventProcessor = new EventProcessor(
      memoryManager,
      stateTransitionManager,
      stepLockManager,
      stepLifecycleManager,
      reducerRegistry,
      observerManager,
      compactionManager,
    );
  });

  describe('processEvent', () => {
    it('should throw error for non-existent thread', async () => {
      const event: BaseEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Hello',
      };

      await expect(
        eventProcessor.processEvent('non-existent', event),
      ).rejects.toThrow('Current state not found for thread: non-existent');
    });

    it('should notify observers of event dispatch', async () => {
      const { thread } = await memoryManager.createThread();
      const event: BaseEvent = {
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
      const { thread, initialState } = await memoryManager.createThread();
      const event: BaseEvent = {
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
      const { thread, initialState } = await memoryManager.createThread();

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations: [],
        chunks: [],
      });

      const event: BaseEvent = {
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
      const { thread, initialState } = await memoryManager.createThread();
      const newChunk = createMockChunk('chunk-1');

      const addOperation = createAddOperation(newChunk.id);

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations: [addOperation],
        chunks: [newChunk],
      });

      const event: BaseEvent = {
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

    // NOTE: Auto-compaction triggering is now handled BEFORE processing events
    // by the caller (EventDispatcher/AgentOrchestrator) using checkCompactionNeeded().
    // Truncation is handled non-destructively in TurnExecutor before LLM calls.
  });

  describe('checkCompactionNeeded', () => {
    it('should return "no" when below soft threshold', async () => {
      const { initialState } = await memoryManager.createThread();

      const result = eventProcessor.checkCompactionNeeded(initialState);

      expect(result).toBe(CompactionCheckResult.NO);
    });

    it('should return "force" when hard threshold exceeded', async () => {
      const { thread } = await memoryManager.createThread();

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

      const event: BaseEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Hello',
      };

      const result = await eventProcessor.processEvent(thread.id, event);

      // Check if compaction is now needed
      const compactionCheck = eventProcessor.checkCompactionNeeded(
        result.state,
      );
      expect(compactionCheck).toBe(CompactionCheckResult.FORCE);
    });
  });

  describe('dispatch strategy flags', () => {
    it('should set shouldTerminate for terminate-type events', async () => {
      const { thread } = await memoryManager.createThread();
      const newChunk = createMockChunk('chunk-1');
      const addOperation = createAddOperation(newChunk.id);

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations: [addOperation],
        chunks: [newChunk],
      });

      // TASK_COMPLETED should use TERMINATE dispatch strategy
      const event: BaseEvent = {
        type: EventType.TASK_COMPLETED,
        timestamp: Date.now(),
        result: 'Task completed successfully',
        dispatchStrategy: EventDispatchStrategy.TERMINATE,
      };

      const result = await eventProcessor.processEvent(thread.id, event);

      expect(result.shouldTerminate).toBe(true);
      expect(result.shouldInterrupt).toBe(false);
      expect(result.dispatchStrategy).toBe(EventDispatchStrategy.TERMINATE);
    });

    it('should set shouldTerminate for TASK_ABANDONED events', async () => {
      const { thread } = await memoryManager.createThread();

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations: [],
        chunks: [],
      });

      const event: BaseEvent = {
        type: EventType.TASK_ABANDONED,
        timestamp: Date.now(),
        reason: 'User cancelled',
        dispatchStrategy: EventDispatchStrategy.TERMINATE,
      };

      const result = await eventProcessor.processEvent(thread.id, event);

      expect(result.shouldTerminate).toBe(true);
      expect(result.dispatchStrategy).toBe(EventDispatchStrategy.TERMINATE);
    });

    it('should set shouldTerminate for TASK_TERMINATED events', async () => {
      const { thread } = await memoryManager.createThread();

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations: [],
        chunks: [],
      });

      const event: BaseEvent = {
        type: EventType.TASK_TERMINATED,
        timestamp: Date.now(),
        terminatedBy: 'user',
        reason: 'Force stop',
        dispatchStrategy: EventDispatchStrategy.TERMINATE,
      };

      const result = await eventProcessor.processEvent(thread.id, event);

      expect(result.shouldTerminate).toBe(true);
      expect(result.dispatchStrategy).toBe(EventDispatchStrategy.TERMINATE);
    });

    it('should not set shouldTerminate for queue-type events', async () => {
      const { thread } = await memoryManager.createThread();

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations: [],
        chunks: [],
      });

      const event: BaseEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Hello',
      };

      const result = await eventProcessor.processEvent(thread.id, event);

      expect(result.shouldTerminate).toBe(false);
      expect(result.shouldInterrupt).toBe(false);
      expect(result.dispatchStrategy).toBe(EventDispatchStrategy.QUEUE);
    });

    it('should respect explicit dispatchStrategy override', async () => {
      const { thread } = await memoryManager.createThread();

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations: [],
        chunks: [],
      });

      // USER_MESSAGE normally has QUEUE strategy, but we override to INTERRUPT
      const event: BaseEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Urgent message',
        dispatchStrategy: EventDispatchStrategy.INTERRUPT,
      };

      const result = await eventProcessor.processEvent(thread.id, event);

      expect(result.shouldInterrupt).toBe(true);
      expect(result.shouldTerminate).toBe(false);
      expect(result.dispatchStrategy).toBe(EventDispatchStrategy.INTERRUPT);
    });

    it('should allow overriding terminate event to queue', async () => {
      const { thread } = await memoryManager.createThread();

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations: [],
        chunks: [],
      });

      // TASK_COMPLETED normally terminates, but we override to QUEUE
      const event: BaseEvent = {
        type: EventType.TASK_COMPLETED,
        timestamp: Date.now(),
        result: 'Partial result',
        dispatchStrategy: EventDispatchStrategy.QUEUE,
      };

      const result = await eventProcessor.processEvent(thread.id, event);

      expect(result.shouldTerminate).toBe(false);
      expect(result.shouldInterrupt).toBe(false);
      expect(result.dispatchStrategy).toBe(EventDispatchStrategy.QUEUE);
    });
  });

  describe('edge cases', () => {
    it('should handle empty content in event', async () => {
      const { thread } = await memoryManager.createThread();
      const event: BaseEvent = {
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
      const { thread } = await memoryManager.createThread({
        initialChunks: [initialChunk],
      });

      const deleteOperation = createDeleteOperation('initial-chunk');

      (reducerRegistry.reduce as jest.Mock).mockResolvedValue({
        operations: [deleteOperation],
        chunks: [],
      });

      const event: BaseEvent = {
        type: EventType.MEMORY_FORGET,
        timestamp: Date.now(),
        chunkIds: ['initial-chunk'],
      };

      const result = await eventProcessor.processEvent(thread.id, event);

      expect(result.removedChunkIds).toContain('initial-chunk');
    });

    it('should work with multiple sequential events', async () => {
      const { thread } = await memoryManager.createThread();

      // First event adds chunk-1
      const chunk1 = createMockChunk('chunk-1');
      (reducerRegistry.reduce as jest.Mock).mockResolvedValueOnce({
        operations: [createAddOperation(chunk1.id)],
        chunks: [chunk1],
      });

      const event1: BaseEvent = {
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

      const event2: BaseEvent = {
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
