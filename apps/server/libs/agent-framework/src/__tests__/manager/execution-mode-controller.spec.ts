/**
 * Unit tests for ExecutionModeController
 *
 * The ExecutionModeController has been simplified to only track:
 * - Execution mode per thread (auto vs stepping)
 *
 * Note: Compaction is now checked directly before processing events (not via pending state).
 * Truncation is handled non-destructively in TurnExecutor before LLM calls.
 */
import { ExecutionModeController } from '../../manager/execution-mode.controller.js';

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

  describe('cleanup', () => {
    it('should remove thread state', () => {
      controller.initializeExecutionMode('thread-1', 'stepping');
      expect(controller.getExecutionMode('thread-1')).toBe('stepping');

      controller.cleanup('thread-1');

      // After cleanup, thread should return default mode
      expect(controller.getExecutionMode('thread-1')).toBe('auto');
    });

    it('should be safe to call on unknown thread', () => {
      expect(() => controller.cleanup('unknown')).not.toThrow();
    });
  });
});
