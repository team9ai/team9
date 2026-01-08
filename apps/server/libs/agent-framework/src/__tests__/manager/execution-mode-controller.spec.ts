/**
 * Unit tests for ExecutionModeController
 *
 * The ExecutionModeController has been simplified to only track:
 * - Execution mode per thread (auto vs stepping)
 * - Pending compaction/truncation for stepping mode
 *
 * It no longer uses EventQueue (blocking is handled by step lock in ThreadManager)
 */
import { ExecutionModeController } from '../../manager/execution-mode.controller.js';
import {
  MemoryChunk,
  ChunkType,
  ChunkRetentionStrategy,
  ChunkContentType,
} from '../../types/chunk.types.js';
// Mock MemoryChunk for testing
const createMockChunk = (id: string): MemoryChunk => ({
  id,
  type: ChunkType.THINKING,
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

  beforeEach(() => {
    controller = new ExecutionModeController();
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
      controller.initializeExecutionMode('thread-1', 'stepping');
      expect(controller.getExecutionMode('thread-1')).toBe('stepping');
    });
  });

  describe('initializeExecutionMode', () => {
    it('should set execution mode for thread', () => {
      controller.initializeExecutionMode('thread-1', 'stepping');
      expect(controller.getExecutionMode('thread-1')).toBe('stepping');
    });

    it('should use default mode when undefined is passed', () => {
      const ctrl = new ExecutionModeController({
        defaultExecutionMode: 'stepping',
      });
      ctrl.initializeExecutionMode('thread-1', undefined);
      expect(ctrl.getExecutionMode('thread-1')).toBe('stepping');
    });
  });

  describe('setExecutionMode', () => {
    it('should set execution mode', () => {
      controller.initializeExecutionMode('thread-1', 'auto');
      controller.setExecutionMode('thread-1', 'stepping');
      expect(controller.getExecutionMode('thread-1')).toBe('stepping');
    });

    it('should switch from stepping to auto', () => {
      controller.initializeExecutionMode('thread-1', 'stepping');
      controller.setExecutionMode('thread-1', 'auto');
      expect(controller.getExecutionMode('thread-1')).toBe('auto');
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

  describe('pending truncation', () => {
    it('should have no pending truncation initially', () => {
      expect(controller.hasPendingTruncation('thread-1')).toBe(false);
    });

    it('should set pending truncation', () => {
      const chunkIds = ['chunk-1', 'chunk-2'];
      controller.setPendingTruncation('thread-1', chunkIds);
      expect(controller.hasPendingTruncation('thread-1')).toBe(true);
    });

    it('should consume pending truncation', () => {
      const chunkIds = ['chunk-1', 'chunk-2'];
      controller.setPendingTruncation('thread-1', chunkIds);

      const consumed = controller.consumePendingTruncation('thread-1');

      expect(consumed).toEqual(chunkIds);
      expect(controller.hasPendingTruncation('thread-1')).toBe(false);
    });

    it('should return null when no pending truncation', () => {
      const consumed = controller.consumePendingTruncation('thread-1');
      expect(consumed).toBeNull();
    });
  });

  // NOTE: executeMaintenanceStep was removed - priority logic is now directly in MemoryManager.step()
  // The priority order is: truncation > compaction > queue events > LLM response (if needsResponse)

  describe('cleanup', () => {
    it('should remove thread state', () => {
      controller.initializeExecutionMode('thread-1', 'stepping');
      controller.setPendingCompaction('thread-1', [createMockChunk('chunk-1')]);
      controller.setPendingTruncation('thread-1', ['chunk-2']);

      expect(controller.getExecutionMode('thread-1')).toBe('stepping');
      expect(controller.hasPendingCompaction('thread-1')).toBe(true);
      expect(controller.hasPendingTruncation('thread-1')).toBe(true);

      controller.cleanup('thread-1');

      // After cleanup, thread should return default mode
      expect(controller.getExecutionMode('thread-1')).toBe('auto');
      expect(controller.hasPendingCompaction('thread-1')).toBe(false);
      expect(controller.hasPendingTruncation('thread-1')).toBe(false);
    });

    it('should be safe to call on unknown thread', () => {
      expect(() => controller.cleanup('unknown')).not.toThrow();
    });
  });
});
