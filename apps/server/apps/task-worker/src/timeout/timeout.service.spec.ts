import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { TimeoutService } from './timeout.service.js';

function createSelectChain(result: unknown[] = []) {
  return {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockResolvedValue(result),
  };
}

function createExecutionUpdateChain(returningQueue: unknown[][]) {
  return {
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    returning: jest.fn().mockImplementation(() => {
      return Promise.resolve(returningQueue.shift() ?? []);
    }),
  };
}

function createTaskUpdateChain() {
  return {
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockResolvedValue(undefined),
  };
}

describe('TimeoutService', () => {
  let selectChain: ReturnType<typeof createSelectChain>;
  let executionUpdateChain: ReturnType<typeof createExecutionUpdateChain>;
  let taskUpdateChain: ReturnType<typeof createTaskUpdateChain>;
  let db: {
    select: ReturnType<typeof jest.fn>;
    update: ReturnType<typeof jest.fn>;
  };
  let service: TimeoutService;
  let returningQueue: unknown[][];

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-02T10:00:00.000Z'));

    returningQueue = [];
    selectChain = createSelectChain();
    executionUpdateChain = createExecutionUpdateChain(returningQueue);
    taskUpdateChain = createTaskUpdateChain();

    db = {
      select: jest.fn().mockReturnValue(selectChain),
      update: jest
        .fn()
        .mockReturnValueOnce(executionUpdateChain)
        .mockReturnValueOnce(taskUpdateChain),
    };

    service = new TimeoutService(db as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns early when there are no stale executions', async () => {
    selectChain.where.mockResolvedValueOnce([]);

    await service.scanTimedOutExecutions();

    expect(db.update).not.toHaveBeenCalled();
  });

  it('marks stale executions and parent tasks as timeout', async () => {
    const staleExecution = {
      id: 'exec-1',
      taskId: 'task-1',
      startedAt: new Date('2026-04-01T08:00:00.000Z'),
    };
    selectChain.where.mockResolvedValueOnce([staleExecution]);
    returningQueue.push([{ id: 'exec-1', status: 'timeout' }]);

    await service.scanTimedOutExecutions();

    expect(executionUpdateChain.set).toHaveBeenCalledWith({
      status: 'timeout',
      completedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
    expect(taskUpdateChain.set).toHaveBeenCalledWith({
      status: 'timeout',
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
  });

  it('skips parent task updates when the execution already transitioned', async () => {
    const debugSpy = jest.spyOn((service as any).logger, 'debug');
    selectChain.where.mockResolvedValueOnce([
      {
        id: 'exec-1',
        taskId: 'task-1',
        startedAt: new Date('2026-04-01T08:00:00.000Z'),
      },
    ]);
    returningQueue.push([]);

    await service.scanTimedOutExecutions();

    expect(taskUpdateChain.set).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(
      'Execution exec-1 already transitioned, skipping timeout',
    );
  });

  it('continues scanning when one timeout update fails', async () => {
    const errorSpy = jest.spyOn((service as any).logger, 'error');
    const warnSpy = jest.spyOn((service as any).logger, 'warn');
    const staleExecutions = [
      {
        id: 'exec-1',
        taskId: 'task-1',
        startedAt: new Date('2026-04-01T08:00:00.000Z'),
      },
      {
        id: 'exec-2',
        taskId: 'task-2',
        startedAt: new Date('2026-04-01T07:00:00.000Z'),
      },
    ];
    selectChain.where.mockResolvedValueOnce(staleExecutions);

    const failingExecutionUpdateChain = {
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest
        .fn()
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce([{ id: 'exec-2', status: 'timeout' }]),
    };
    const secondTaskUpdateChain = createTaskUpdateChain();
    db.update = jest
      .fn()
      .mockReturnValueOnce(failingExecutionUpdateChain)
      .mockReturnValueOnce(executionUpdateChain)
      .mockReturnValueOnce(secondTaskUpdateChain);
    returningQueue.push([{ id: 'exec-2', status: 'timeout' }]);

    await service.scanTimedOutExecutions();

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to mark execution exec-1 as timeout: Error: db down',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'Found 2 timed-out execution(s), marking as timeout',
    );
    expect(secondTaskUpdateChain.set).toHaveBeenCalledWith({
      status: 'timeout',
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
  });
});
