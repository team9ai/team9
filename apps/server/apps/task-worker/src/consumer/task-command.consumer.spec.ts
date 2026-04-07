import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { TaskCommand } from './task-command.consumer.js';

// ── ExecutorService mock ──────────────────────────────────────────────

const mockExecutor = {
  triggerExecution: jest.fn<any>().mockResolvedValue(undefined),
  pauseExecution: jest.fn<any>().mockResolvedValue(undefined),
  resumeExecution: jest.fn<any>().mockResolvedValue(undefined),
  stopExecution: jest.fn<any>().mockResolvedValue(undefined),
};

// ── Tests ─────────────────────────────────────────────────────────────

describe('TaskCommandConsumer', () => {
  let TaskCommandConsumer: any;
  let consumer: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    ({ TaskCommandConsumer } = await import('./task-command.consumer.js'));
    consumer = new TaskCommandConsumer(mockExecutor);
  });

  it('calls triggerExecution for start command', async () => {
    const command: TaskCommand = {
      type: 'start',
      routineId: 'task-001',
      userId: 'user-001',
    };

    await consumer.handleCommand(command);

    expect(mockExecutor.triggerExecution).toHaveBeenCalledWith(
      'task-001',
      expect.objectContaining({ triggerType: 'manual' }),
    );
  });

  it('calls triggerExecution for restart command', async () => {
    const command: TaskCommand = {
      type: 'restart',
      routineId: 'task-002',
      userId: 'user-001',
      triggerId: 'trigger-1',
      notes: 'restart it',
    };

    await consumer.handleCommand(command);

    expect(mockExecutor.triggerExecution).toHaveBeenCalledWith(
      'task-002',
      expect.objectContaining({
        triggerId: 'trigger-1',
        triggerType: 'manual',
      }),
    );
  });

  it('calls triggerExecution with retry triggerType for retry command', async () => {
    const command: TaskCommand = {
      type: 'retry',
      routineId: 'task-003',
      userId: 'user-001',
      sourceExecutionId: 'exec-old',
    };

    await consumer.handleCommand(command);

    expect(mockExecutor.triggerExecution).toHaveBeenCalledWith(
      'task-003',
      expect.objectContaining({
        triggerType: 'retry',
        sourceExecutionId: 'exec-old',
      }),
    );
  });

  it('calls pauseExecution for pause command', async () => {
    const command: TaskCommand = {
      type: 'pause',
      routineId: 'task-004',
      userId: 'user-001',
    };

    await consumer.handleCommand(command);

    expect(mockExecutor.pauseExecution).toHaveBeenCalledWith('task-004');
  });

  it('calls resumeExecution for resume command', async () => {
    const command: TaskCommand = {
      type: 'resume',
      routineId: 'task-005',
      userId: 'user-001',
      message: 'please continue',
    };

    await consumer.handleCommand(command);

    expect(mockExecutor.resumeExecution).toHaveBeenCalledWith(
      'task-005',
      'please continue',
    );
  });

  it('calls stopExecution for stop command', async () => {
    const command: TaskCommand = {
      type: 'stop',
      routineId: 'task-006',
      userId: 'user-001',
    };

    await consumer.handleCommand(command);

    expect(mockExecutor.stopExecution).toHaveBeenCalledWith('task-006');
  });

  it('returns Nack(false) when executor throws', async () => {
    mockExecutor.triggerExecution.mockRejectedValueOnce(
      new Error('DB connection lost'),
    );

    const command: TaskCommand = {
      type: 'start',
      routineId: 'task-err',
      userId: 'user-001',
    };

    const result = await consumer.handleCommand(command);

    // Nack(false) means "do not requeue, send to DLX"
    expect(result).toBeDefined();
    expect(result.constructor.name).toBe('Nack');
  });

  it('does not throw for unknown command type', async () => {
    const command = {
      type: 'unknown-type',
      routineId: 'task-x',
      userId: 'user-001',
    } as unknown as TaskCommand;

    await expect(consumer.handleCommand(command)).resolves.not.toThrow();
  });
});
