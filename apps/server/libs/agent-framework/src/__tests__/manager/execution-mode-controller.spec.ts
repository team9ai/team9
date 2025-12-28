/**
 * Unit tests for ExecutionModeController
 */
import {
  ExecutionModeController,
  StepResult,
} from '../../manager/execution-mode.controller.js';
import { EventQueue, BlockingReason } from '../../manager/event-queue.js';
import { EventType, AgentEvent } from '../../types/index.js';
import {
  MemoryChunk,
  ChunkType,
  ChunkRetentionStrategy,
  ChunkContentType,
} from '../../types/chunk.types.js';
import type { DispatchResult } from '../../manager/memory.manager.js';

// Mock DispatchResult for testing
const createMockDispatchResult = (): DispatchResult => ({
  thread: {
    id: 'thread-1',
    metadata: {
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    currentStateId: 'state-1',
    initialStateId: 'state-1',
  },
  state: {
    id: 'state-1',
    threadId: 'thread-1',
    chunkIds: [],
    chunks: new Map(),
    metadata: {
      createdAt: Date.now(),
    },
  },
  addedChunks: [],
  removedChunkIds: [],
});

// Mock MemoryChunk for testing
const createMockChunk = (id: string): MemoryChunk => ({
  id,
  type: ChunkType.WORKING_FLOW,
  content: { type: ChunkContentType.TEXT, text: 'test' },
  retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
  mutable: false,
  priority: 0,
  metadata: {
    createdAt: Date.now(),
  },
});

describe('ExecutionModeController', () => {
  let controller: ExecutionModeController;
  let queue: EventQueue<DispatchResult>;

  beforeEach(() => {
    controller = new ExecutionModeController();
    queue = new EventQueue<DispatchResult>();
  });

  describe('constructor', () => {
    it('should use default execution mode "auto"', () => {
      const ctrl = new ExecutionModeController();
      expect(ctrl.getExecutionMode('any-thread')).toBe('auto');
    });

    it('should use provided default execution mode', () => {
      const ctrl = new ExecutionModeController({
        defaultExecutionMode: 'stepping',
      });
      expect(ctrl.getExecutionMode('any-thread')).toBe('stepping');
    });
  });

  describe('getExecutionMode', () => {
    it('should return default mode for unknown thread', () => {
      expect(controller.getExecutionMode('unknown')).toBe('auto');
    });

    it('should return set mode for known thread', () => {
      controller.initializeExecutionMode('thread-1', 'stepping', queue);
      expect(controller.getExecutionMode('thread-1')).toBe('stepping');
    });
  });

  describe('initializeExecutionMode', () => {
    it('should set execution mode for thread', () => {
      controller.initializeExecutionMode('thread-1', 'stepping', queue);
      expect(controller.getExecutionMode('thread-1')).toBe('stepping');
    });

    it('should block queue when initializing in stepping mode', () => {
      controller.initializeExecutionMode('thread-1', 'stepping', queue);
      expect(queue.isBlocked()).toBe(true);
      expect(queue.getBlockingReason()).toBe(BlockingReason.STEPPING);
    });

    it('should not block queue when initializing in auto mode', () => {
      controller.initializeExecutionMode('thread-1', 'auto', queue);
      expect(queue.isBlocked()).toBe(false);
    });

    it('should use default mode when undefined is passed', () => {
      const ctrl = new ExecutionModeController({
        defaultExecutionMode: 'stepping',
      });
      ctrl.initializeExecutionMode('thread-1', undefined, queue);
      expect(ctrl.getExecutionMode('thread-1')).toBe('stepping');
    });
  });

  describe('setExecutionMode', () => {
    const mockProcessEvent = jest
      .fn()
      .mockResolvedValue(createMockDispatchResult());

    beforeEach(() => {
      mockProcessEvent.mockClear();
    });

    it('should do nothing when setting same mode', async () => {
      controller.initializeExecutionMode('thread-1', 'auto', queue);
      await controller.setExecutionMode(
        'thread-1',
        'auto',
        queue,
        mockProcessEvent,
      );
      expect(queue.isBlocked()).toBe(false);
    });

    it('should block queue when switching to stepping mode', async () => {
      controller.initializeExecutionMode('thread-1', 'auto', queue);
      await controller.setExecutionMode(
        'thread-1',
        'stepping',
        queue,
        mockProcessEvent,
      );

      expect(controller.getExecutionMode('thread-1')).toBe('stepping');
      expect(queue.isBlocked()).toBe(true);
      expect(queue.getBlockingReason()).toBe(BlockingReason.STEPPING);
    });

    it('should unblock queue when switching to auto mode', async () => {
      controller.initializeExecutionMode('thread-1', 'stepping', queue);
      expect(queue.isBlocked()).toBe(true);

      await controller.setExecutionMode(
        'thread-1',
        'auto',
        queue,
        mockProcessEvent,
      );

      expect(controller.getExecutionMode('thread-1')).toBe('auto');
      expect(queue.isBlocked()).toBe(false);
    });

    it('should process queued events when switching to auto mode', async () => {
      controller.initializeExecutionMode('thread-1', 'stepping', queue);

      // Enqueue events while in stepping mode
      const event1: AgentEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Hello',
      };
      const event2: AgentEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'World',
      };
      queue.enqueue(event1);
      queue.enqueue(event2);

      expect(queue.getQueueLength()).toBe(2);

      // Switch to auto - should process all queued events
      await controller.setExecutionMode(
        'thread-1',
        'auto',
        queue,
        mockProcessEvent,
      );

      expect(mockProcessEvent).toHaveBeenCalledTimes(2);
      expect(mockProcessEvent).toHaveBeenNthCalledWith(1, 'thread-1', event1);
      expect(mockProcessEvent).toHaveBeenNthCalledWith(2, 'thread-1', event2);
      expect(queue.getQueueLength()).toBe(0);
    });
  });

  describe('pending compaction', () => {
    it('should have no pending compaction initially', () => {
      expect(controller.hasPendingCompaction('thread-1')).toBe(false);
    });

    it('should set pending compaction', () => {
      const chunks = [createMockChunk('chunk-1')];
      controller.setPendingCompaction('thread-1', chunks);
      expect(controller.hasPendingCompaction('thread-1')).toBe(true);
    });

    it('should consume pending compaction', () => {
      const chunks = [createMockChunk('chunk-1'), createMockChunk('chunk-2')];
      controller.setPendingCompaction('thread-1', chunks);

      const consumed = controller.consumePendingCompaction('thread-1');

      expect(consumed).toEqual(chunks);
      expect(controller.hasPendingCompaction('thread-1')).toBe(false);
    });

    it('should return null when no pending compaction', () => {
      const consumed = controller.consumePendingCompaction('thread-1');
      expect(consumed).toBeNull();
    });
  });

  describe('step', () => {
    const mockExecuteCompaction = jest
      .fn()
      .mockResolvedValue(createMockDispatchResult());
    const mockExecuteTruncation = jest
      .fn()
      .mockResolvedValue(createMockDispatchResult());

    beforeEach(() => {
      mockExecuteCompaction.mockClear();
      mockExecuteTruncation.mockClear();
    });

    it('should throw error when not in stepping mode', async () => {
      controller.initializeExecutionMode('thread-1', 'auto', queue);

      await expect(
        controller.step(
          'thread-1',
          queue,
          mockExecuteCompaction,
          mockExecuteTruncation,
        ),
      ).rejects.toThrow("Cannot step in 'auto' mode");
    });

    it('should return empty result when no pending operations', async () => {
      controller.initializeExecutionMode('thread-1', 'stepping', queue);

      const result = await controller.step(
        'thread-1',
        queue,
        mockExecuteCompaction,
        mockExecuteTruncation,
      );

      expect(result).toEqual({
        dispatchResult: null,
        compactionPerformed: false,
        truncationPerformed: false,
        hasPendingOperations: false,
      });
      expect(mockExecuteCompaction).not.toHaveBeenCalled();
      expect(mockExecuteTruncation).not.toHaveBeenCalled();
    });

    it('should execute pending compaction', async () => {
      controller.initializeExecutionMode('thread-1', 'stepping', queue);

      // Set up pending compaction
      const chunks = [createMockChunk('chunk-1')];
      controller.setPendingCompaction('thread-1', chunks);

      const result = await controller.step(
        'thread-1',
        queue,
        mockExecuteCompaction,
        mockExecuteTruncation,
      );

      expect(result.compactionPerformed).toBe(true);
      expect(result.truncationPerformed).toBe(false);
      expect(result.hasPendingOperations).toBe(false);
      expect(mockExecuteCompaction).toHaveBeenCalledTimes(1);
      expect(mockExecuteCompaction).toHaveBeenCalledWith('thread-1', chunks);
      expect(controller.hasPendingCompaction('thread-1')).toBe(false);
    });

    it('should execute pending truncation', async () => {
      controller.initializeExecutionMode('thread-1', 'stepping', queue);

      // Set up pending truncation
      const chunkIds = ['chunk-1', 'chunk-2'];
      controller.setPendingTruncation('thread-1', chunkIds);

      const result = await controller.step(
        'thread-1',
        queue,
        mockExecuteCompaction,
        mockExecuteTruncation,
      );

      expect(result.truncationPerformed).toBe(true);
      expect(result.compactionPerformed).toBe(false);
      expect(result.hasPendingOperations).toBe(false);
      expect(mockExecuteTruncation).toHaveBeenCalledTimes(1);
      expect(mockExecuteTruncation).toHaveBeenCalledWith('thread-1', chunkIds);
      expect(controller.hasPendingTruncation('thread-1')).toBe(false);
    });

    it('should prioritize truncation over compaction', async () => {
      controller.initializeExecutionMode('thread-1', 'stepping', queue);

      // Set up both pending truncation and compaction
      const chunks = [createMockChunk('chunk-1')];
      controller.setPendingCompaction('thread-1', chunks);
      const chunkIds = ['chunk-2', 'chunk-3'];
      controller.setPendingTruncation('thread-1', chunkIds);

      const result = await controller.step(
        'thread-1',
        queue,
        mockExecuteCompaction,
        mockExecuteTruncation,
      );

      // Truncation should be executed first
      expect(result.truncationPerformed).toBe(true);
      expect(result.compactionPerformed).toBe(false);
      expect(result.hasPendingOperations).toBe(true); // Compaction still pending
      expect(mockExecuteTruncation).toHaveBeenCalledTimes(1);
      expect(mockExecuteCompaction).not.toHaveBeenCalled();

      // Second step should execute compaction
      const result2 = await controller.step(
        'thread-1',
        queue,
        mockExecuteCompaction,
        mockExecuteTruncation,
      );

      expect(result2.compactionPerformed).toBe(true);
      expect(result2.truncationPerformed).toBe(false);
      expect(result2.hasPendingOperations).toBe(false);
      expect(mockExecuteCompaction).toHaveBeenCalledTimes(1);
    });

    it('should re-block queue after processing', async () => {
      controller.initializeExecutionMode('thread-1', 'stepping', queue);

      const chunks = [createMockChunk('chunk-1')];
      controller.setPendingCompaction('thread-1', chunks);

      await controller.step(
        'thread-1',
        queue,
        mockExecuteCompaction,
        mockExecuteTruncation,
      );

      expect(queue.isBlocked()).toBe(true);
      expect(queue.getBlockingReason()).toBe(BlockingReason.STEPPING);
    });

    it('should re-block queue even if processing throws', async () => {
      controller.initializeExecutionMode('thread-1', 'stepping', queue);

      const chunks = [createMockChunk('chunk-1')];
      controller.setPendingCompaction('thread-1', chunks);

      mockExecuteCompaction.mockRejectedValueOnce(
        new Error('Compaction failed'),
      );

      await expect(
        controller.step(
          'thread-1',
          queue,
          mockExecuteCompaction,
          mockExecuteTruncation,
        ),
      ).rejects.toThrow('Compaction failed');

      expect(queue.isBlocked()).toBe(true);
      expect(queue.getBlockingReason()).toBe(BlockingReason.STEPPING);
    });
  });

  describe('cleanup', () => {
    it('should remove thread state', () => {
      controller.initializeExecutionMode('thread-1', 'stepping', queue);
      controller.setPendingCompaction('thread-1', [createMockChunk('chunk-1')]);

      expect(controller.getExecutionMode('thread-1')).toBe('stepping');
      expect(controller.hasPendingCompaction('thread-1')).toBe(true);

      controller.cleanup('thread-1');

      // After cleanup, thread should return default mode
      expect(controller.getExecutionMode('thread-1')).toBe('auto');
      expect(controller.hasPendingCompaction('thread-1')).toBe(false);
    });

    it('should be safe to call on unknown thread', () => {
      expect(() => controller.cleanup('unknown')).not.toThrow();
    });
  });

  describe('forceUnblockStepping', () => {
    it('should unblock queue blocked for STEPPING', () => {
      queue.block(BlockingReason.STEPPING);
      expect(queue.isBlocked()).toBe(true);

      controller.forceUnblockStepping(queue);

      expect(queue.isBlocked()).toBe(false);
    });

    it('should not unblock queue blocked for other reasons', () => {
      queue.block(BlockingReason.COMPACTING);
      expect(queue.isBlocked()).toBe(true);

      controller.forceUnblockStepping(queue);

      // Should still be blocked
      expect(queue.isBlocked()).toBe(true);
      expect(queue.getBlockingReason()).toBe(BlockingReason.COMPACTING);
    });

    it('should be safe to call on non-blocked queue', () => {
      expect(queue.isBlocked()).toBe(false);
      expect(() => controller.forceUnblockStepping(queue)).not.toThrow();
    });
  });
});
