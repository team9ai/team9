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

function createRunUpdateChain(returningQueue: unknown[][]) {
  return {
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    returning: jest.fn().mockImplementation(() => {
      return Promise.resolve(returningQueue.shift() ?? []);
    }),
  };
}

function createUpdateChain() {
  return {
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockResolvedValue(undefined),
  };
}

describe('TimeoutService', () => {
  let selectChain: ReturnType<typeof createSelectChain>;
  let runUpdateChain: ReturnType<typeof createRunUpdateChain>;
  let legacyExecutionUpdateChain: ReturnType<typeof createUpdateChain>;
  let routineUpdateChain: ReturnType<typeof createUpdateChain>;
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
    runUpdateChain = createRunUpdateChain(returningQueue);
    legacyExecutionUpdateChain = createUpdateChain();
    routineUpdateChain = createUpdateChain();

    db = {
      select: jest.fn().mockReturnValue(selectChain),
      update: jest
        .fn()
        .mockReturnValueOnce(runUpdateChain)
        .mockReturnValueOnce(legacyExecutionUpdateChain)
        .mockReturnValueOnce(routineUpdateChain),
    };

    service = new TimeoutService(db as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns early when there are no stale task runs', async () => {
    selectChain.where.mockResolvedValueOnce([]);

    await service.scanTimedOutExecutions();

    expect(db.update).not.toHaveBeenCalled();
  });

  it('marks stale task runs and routine compatibility rows as timeout', async () => {
    const staleRun = {
      id: 'exec-1',
      routineId: 'task-1',
      startedAt: new Date('2026-04-01T08:00:00.000Z'),
    };
    selectChain.where.mockResolvedValueOnce([staleRun]);
    returningQueue.push([{ id: 'exec-1', status: 'timeout' }]);

    await service.scanTimedOutExecutions();

    expect(runUpdateChain.set).toHaveBeenCalledWith({
      status: 'timeout',
      completedAt: new Date('2026-04-02T10:00:00.000Z'),
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
    expect(legacyExecutionUpdateChain.set).toHaveBeenCalledWith({
      status: 'timeout',
      completedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
    expect(routineUpdateChain.set).toHaveBeenCalledWith({
      status: 'timeout',
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
  });

  it('skips compatibility updates when the run already transitioned', async () => {
    const debugSpy = jest.spyOn((service as any).logger, 'debug');
    selectChain.where.mockResolvedValueOnce([
      {
        id: 'exec-1',
        routineId: 'task-1',
        startedAt: new Date('2026-04-01T08:00:00.000Z'),
      },
    ]);
    returningQueue.push([]);

    await service.scanTimedOutExecutions();

    expect(legacyExecutionUpdateChain.set).not.toHaveBeenCalled();
    expect(routineUpdateChain.set).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(
      'Task run exec-1 already transitioned, skipping timeout',
    );
  });

  it('continues scanning when one timeout update fails', async () => {
    const errorSpy = jest.spyOn((service as any).logger, 'error');
    const warnSpy = jest.spyOn((service as any).logger, 'warn');
    const staleRuns = [
      {
        id: 'exec-1',
        routineId: 'task-1',
        startedAt: new Date('2026-04-01T08:00:00.000Z'),
      },
      {
        id: 'exec-2',
        routineId: 'task-2',
        startedAt: new Date('2026-04-01T07:00:00.000Z'),
      },
    ];
    selectChain.where.mockResolvedValueOnce(staleRuns);

    const failingRunUpdateChain = {
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest
        .fn()
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce([{ id: 'exec-2', status: 'timeout' }]),
    };
    const secondLegacyExecutionUpdateChain = createUpdateChain();
    const secondRoutineUpdateChain = createUpdateChain();
    db.update = jest
      .fn()
      .mockReturnValueOnce(failingRunUpdateChain)
      .mockReturnValueOnce(runUpdateChain)
      .mockReturnValueOnce(secondLegacyExecutionUpdateChain)
      .mockReturnValueOnce(secondRoutineUpdateChain);
    returningQueue.push([{ id: 'exec-2', status: 'timeout' }]);

    await service.scanTimedOutExecutions();

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to mark task run exec-1 as timeout: Error: db down',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'Found 2 timed-out task run(s), marking as timeout',
    );
    expect(secondLegacyExecutionUpdateChain.set).toHaveBeenCalledWith({
      status: 'timeout',
      completedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
    expect(secondRoutineUpdateChain.set).toHaveBeenCalledWith({
      status: 'timeout',
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
  });
});
