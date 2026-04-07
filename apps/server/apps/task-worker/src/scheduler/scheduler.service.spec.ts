import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { SchedulerService, calculateNextRunAt } from './scheduler.service.js';

function createSelectChain(result: unknown[] = []) {
  return {
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockResolvedValue(result),
  };
}

function createUpdateChain() {
  return {
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockResolvedValue(undefined),
  };
}

describe('calculateNextRunAt', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns null when frequency is missing or unsupported', () => {
    expect(calculateNextRunAt()).toBeNull();
    expect(
      calculateNextRunAt({
        frequency: 'unknown' as never,
        time: '10:00',
      }),
    ).toBeNull();
  });

  it('calculates the next daily run in UTC', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-02T10:00:00.000Z'));

    expect(
      calculateNextRunAt({
        frequency: 'daily',
        time: '12:30',
        timezone: 'UTC',
      })?.toISOString(),
    ).toBe('2026-04-02T12:30:00.000Z');

    expect(
      calculateNextRunAt({
        frequency: 'daily',
        time: '09:15',
        timezone: 'UTC',
      })?.toISOString(),
    ).toBe('2026-04-03T09:15:00.000Z');
  });

  it('calculates weekly, weekdays, monthly, and yearly runs', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-02T10:00:00.000Z'));

    expect(
      calculateNextRunAt({
        frequency: 'weekly',
        time: '08:00',
        dayOfWeek: 5,
        timezone: 'UTC',
      })?.toISOString(),
    ).toBe('2026-04-03T08:00:00.000Z');

    expect(
      calculateNextRunAt({
        frequency: 'yearly',
        time: '09:00',
        dayOfMonth: 10,
        timezone: 'UTC',
      })?.toISOString(),
    ).toBe('2026-04-10T09:00:00.000Z');

    jest.setSystemTime(new Date('2026-04-30T10:00:00.000Z'));

    expect(
      calculateNextRunAt({
        frequency: 'monthly',
        time: '09:00',
        dayOfMonth: 31,
        timezone: 'UTC',
      })?.toISOString(),
    ).toBe('2026-05-31T09:00:00.000Z');

    jest.setSystemTime(new Date('2026-04-04T10:00:00.000Z'));

    expect(
      calculateNextRunAt({
        frequency: 'weekdays',
        time: '09:00',
        timezone: 'UTC',
      })?.toISOString(),
    ).toBe('2026-04-06T09:00:00.000Z');
  });

  it('uses the server local timezone when no timezone is provided', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-02T10:00:00.000Z'));

    const now = new Date();
    const expected = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      0,
      0,
    );

    expect(
      calculateNextRunAt({
        frequency: 'daily',
        time: '23:59',
      })?.toISOString(),
    ).toBe(expected.toISOString());
  });

  it('defaults to midnight when the time is missing or invalid', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-02T10:00:00.000Z'));

    expect(
      calculateNextRunAt({
        frequency: 'daily',
        timezone: 'UTC',
      })?.toISOString(),
    ).toBe('2026-04-03T00:00:00.000Z');

    expect(
      calculateNextRunAt({
        frequency: 'daily',
        time: 'not-a-time',
        timezone: 'UTC',
      })?.toISOString(),
    ).toBe('2026-04-03T00:00:00.000Z');
  });

  it('falls back to zero offset when timezone formatting fails', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-02T10:00:00.000Z'));

    const realDateTimeFormat = Intl.DateTimeFormat;
    const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(((
      locale: string,
      options?: Intl.DateTimeFormatOptions,
    ) => {
      if (options?.second) {
        throw new RangeError('timezone formatting failed');
      }

      return new realDateTimeFormat(locale, options);
    }) as typeof Intl.DateTimeFormat);

    try {
      expect(
        calculateNextRunAt({
          frequency: 'daily',
          time: '12:30',
          timezone: 'UTC',
        })?.toISOString(),
      ).toBe('2026-04-02T12:30:00.000Z');
    } finally {
      spy.mockRestore();
    }
  });

  it('rolls weekly, monthly, and yearly schedules forward when the slot already passed', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-03T10:00:00.000Z'));

    expect(
      calculateNextRunAt({
        frequency: 'weekly',
        time: '08:00',
        dayOfWeek: 5,
        timezone: 'UTC',
      })?.toISOString(),
    ).toBe('2026-04-10T08:00:00.000Z');

    jest.setSystemTime(new Date('2026-04-02T10:00:00.000Z'));

    expect(
      calculateNextRunAt({
        frequency: 'monthly',
        time: '09:00',
        dayOfMonth: 15,
        timezone: 'UTC',
      })?.toISOString(),
    ).toBe('2026-04-15T09:00:00.000Z');

    expect(
      calculateNextRunAt({
        frequency: 'yearly',
        time: '09:00',
        dayOfMonth: 1,
        timezone: 'UTC',
      })?.toISOString(),
    ).toBe('2027-04-01T09:00:00.000Z');
  });

  it('falls back to the next Monday path when weekday lookup never resolves', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-02T10:00:00.000Z'));

    const realDateTimeFormat = Intl.DateTimeFormat;
    const spy = jest
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(
        (locale: string, options?: Intl.DateTimeFormatOptions) => {
          const formatter = new realDateTimeFormat(
            locale,
            options,
          ) as Intl.DateTimeFormat & {
            formatToParts: (date?: Date | number) => Intl.DateTimeFormatPart[];
          };

          if (options?.weekday) {
            const originalFormatToParts =
              formatter.formatToParts.bind(formatter);
            formatter.formatToParts = (date?: Date | number) =>
              originalFormatToParts(date).map((part) =>
                part.type === 'weekday' ? { ...part, value: 'Sat' } : part,
              );
          }

          return formatter;
        },
      ) as typeof Intl.DateTimeFormat;

    try {
      expect(
        calculateNextRunAt({
          frequency: 'weekdays',
          time: '09:00',
          timezone: 'UTC',
        })?.toISOString(),
      ).toBe('2026-04-04T09:00:00.000Z');
    } finally {
      spy.mockRestore();
    }
  });

  it('treats unknown weekday labels as Sunday when resolving the next weekday', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-02T10:00:00.000Z'));

    const realDateTimeFormat = Intl.DateTimeFormat;
    const spy = jest
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(
        (locale: string, options?: Intl.DateTimeFormatOptions) => {
          const formatter = new realDateTimeFormat(
            locale,
            options,
          ) as Intl.DateTimeFormat & {
            formatToParts: (date?: Date | number) => Intl.DateTimeFormatPart[];
          };

          if (options?.weekday) {
            const originalFormatToParts =
              formatter.formatToParts.bind(formatter);
            formatter.formatToParts = (date?: Date | number) =>
              originalFormatToParts(date).map((part) =>
                part.type === 'weekday' ? { ...part, value: 'Funday' } : part,
              );
          }

          return formatter;
        },
      ) as typeof Intl.DateTimeFormat;

    try {
      expect(
        calculateNextRunAt({
          frequency: 'weekdays',
          time: '09:00',
          timezone: 'UTC',
        })?.toISOString(),
      ).toBe('2026-04-03T09:00:00.000Z');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('SchedulerService', () => {
  let selectChain: ReturnType<typeof createSelectChain>;
  let updateChain: ReturnType<typeof createUpdateChain>;
  let db: {
    select: ReturnType<typeof jest.fn>;
    update: ReturnType<typeof jest.fn>;
  };
  let executor: {
    triggerExecution: ReturnType<typeof jest.fn>;
  };
  let redisClient: {
    set: ReturnType<typeof jest.fn>;
    eval: ReturnType<typeof jest.fn>;
  };
  let redis: {
    getClient: ReturnType<typeof jest.fn>;
  };
  let service: SchedulerService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-02T10:00:00.000Z'));

    selectChain = createSelectChain();
    updateChain = createUpdateChain();

    db = {
      select: jest.fn().mockReturnValue(selectChain),
      update: jest.fn().mockReturnValue(updateChain),
    };

    executor = {
      triggerExecution: jest.fn().mockResolvedValue(undefined),
    };

    redisClient = {
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(1),
    };

    redis = {
      getClient: jest.fn().mockReturnValue(redisClient),
    };

    service = new SchedulerService(
      db as never,
      executor as never,
      redis as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns true when the redis lock is acquired', async () => {
    await expect((service as any).acquireLock()).resolves.toBe(true);
    expect(redisClient.set).toHaveBeenCalledWith(
      'task-scheduler:scan-lock',
      expect.any(String),
      'EX',
      25,
      'NX',
    );
  });

  it('returns false when another instance already holds the lock', async () => {
    redisClient.set.mockResolvedValueOnce(null);

    await expect((service as any).acquireLock()).resolves.toBe(false);
  });

  it('releases the redis lock when the stored value still matches', async () => {
    await (service as any).releaseLock();

    expect(redisClient.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("get", KEYS[1])'),
      1,
      'task-scheduler:scan-lock',
      (service as any).lockValue,
    );
  });

  it('swallows redis release failures and logs a warning', async () => {
    const warnSpy = jest.spyOn((service as any).logger, 'warn');
    redisClient.eval.mockRejectedValueOnce(new Error('redis down'));

    await expect((service as any).releaseLock()).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to release scheduler lock: Error: redis down',
      ),
    );
  });

  it('skips scanning when the lock is not acquired', async () => {
    const acquireLockSpy = jest
      .spyOn(service as any, 'acquireLock')
      .mockResolvedValue(false);
    const doScanSpy = jest.spyOn(service as any, 'doScan');
    const releaseLockSpy = jest.spyOn(service as any, 'releaseLock');

    await service.scanRecurringTasks();

    expect(acquireLockSpy).toHaveBeenCalled();
    expect(doScanSpy).not.toHaveBeenCalled();
    expect(releaseLockSpy).not.toHaveBeenCalled();
  });

  it('releases the lock even when scanning throws', async () => {
    jest.spyOn(service as any, 'acquireLock').mockResolvedValue(true);
    jest
      .spyOn(service as any, 'doScan')
      .mockRejectedValue(new Error('scan failed'));
    const releaseLockSpy = jest
      .spyOn(service as any, 'releaseLock')
      .mockResolvedValue(undefined);

    await expect(service.scanRecurringTasks()).rejects.toThrow('scan failed');
    expect(releaseLockSpy).toHaveBeenCalled();
  });

  it('returns early when no triggers are due', async () => {
    selectChain.where.mockResolvedValueOnce([]);

    await (service as any).doScan();

    expect(executor.triggerExecution).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('triggers due interval tasks and persists the next run time', async () => {
    const trigger = {
      id: 'trigger-1',
      routineId: 'task-1',
      type: 'interval',
      config: { every: 2, unit: 'hours' },
      nextRunAt: new Date('2026-04-02T09:00:00.000Z'),
    };
    selectChain.where.mockResolvedValueOnce([{ trigger, taskStatus: 'idle' }]);

    await (service as any).doScan();

    expect(executor.triggerExecution).toHaveBeenCalledWith('task-1', {
      triggerId: 'trigger-1',
      triggerType: 'interval',
      triggerContext: {
        triggeredAt: '2026-04-02T10:00:00.000Z',
        scheduledAt: '2026-04-02T09:00:00.000Z',
      },
    });
    expect(db.update).toHaveBeenCalled();
    expect(updateChain.set).toHaveBeenCalledWith({
      nextRunAt: new Date('2026-04-02T12:00:00.000Z'),
      lastRunAt: new Date('2026-04-02T10:00:00.000Z'),
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
  });

  it('uses schedule configs and leaves nextRunAt null for unsupported trigger types', async () => {
    const scheduleTrigger = {
      id: 'trigger-schedule',
      routineId: 'task-schedule',
      type: 'schedule',
      config: {
        frequency: 'daily',
        time: '11:30',
        timezone: 'UTC',
      },
      nextRunAt: null,
    };
    const unsupportedTrigger = {
      id: 'trigger-manual',
      routineId: 'task-manual',
      type: 'manual',
      config: { every: 1, unit: 'days' },
      nextRunAt: null,
    };
    selectChain.where.mockResolvedValueOnce([
      { trigger: scheduleTrigger, taskStatus: 'idle' },
      { trigger: unsupportedTrigger, taskStatus: 'idle' },
    ]);

    await (service as any).doScan();

    expect(updateChain.set).toHaveBeenNthCalledWith(1, {
      nextRunAt: new Date('2026-04-02T11:30:00.000Z'),
      lastRunAt: new Date('2026-04-02T10:00:00.000Z'),
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
    expect(updateChain.set).toHaveBeenNthCalledWith(2, {
      nextRunAt: null,
      lastRunAt: new Date('2026-04-02T10:00:00.000Z'),
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
  });

  it('returns null when a trigger has no config', async () => {
    const trigger = {
      id: 'trigger-no-config',
      routineId: 'task-no-config',
      type: 'schedule',
      config: null,
      nextRunAt: null,
    };
    selectChain.where.mockResolvedValueOnce([{ trigger, taskStatus: 'idle' }]);

    await (service as any).doScan();

    expect(updateChain.set).toHaveBeenCalledWith({
      nextRunAt: null,
      lastRunAt: new Date('2026-04-02T10:00:00.000Z'),
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
  });

  it('continues scanning when one trigger execution fails', async () => {
    const triggerOne = {
      id: 'trigger-1',
      routineId: 'task-1',
      type: 'interval',
      config: { every: 1, unit: 'days' },
      nextRunAt: null,
    };
    const triggerTwo = {
      id: 'trigger-2',
      routineId: 'task-2',
      type: 'interval',
      config: { every: 30, unit: 'minutes' },
      nextRunAt: null,
    };
    executor.triggerExecution
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    selectChain.where.mockResolvedValueOnce([
      { trigger: triggerOne, taskStatus: 'idle' },
      { trigger: triggerTwo, taskStatus: 'idle' },
    ]);

    await (service as any).doScan();

    expect(executor.triggerExecution).toHaveBeenCalledTimes(2);
    expect(updateChain.set).toHaveBeenCalledTimes(1);
    expect(updateChain.where).toHaveBeenCalledWith(expect.anything());
  });

  it('supports all interval units when persisting the next scan time', async () => {
    const triggerDefinitions = [
      {
        id: 'trigger-minutes',
        routineId: 'task-minutes',
        type: 'interval',
        config: { every: 1, unit: 'minutes' },
      },
      {
        id: 'trigger-hours',
        routineId: 'task-hours',
        type: 'interval',
        config: { every: 2, unit: 'hours' },
      },
      {
        id: 'trigger-days',
        routineId: 'task-days',
        type: 'interval',
        config: { every: 3, unit: 'days' },
      },
      {
        id: 'trigger-weeks',
        routineId: 'task-weeks',
        type: 'interval',
        config: { every: 1, unit: 'weeks' },
      },
      {
        id: 'trigger-months',
        routineId: 'task-months',
        type: 'interval',
        config: { every: 1, unit: 'months' },
      },
      {
        id: 'trigger-years',
        routineId: 'task-years',
        type: 'interval',
        config: { every: 1, unit: 'years' },
      },
      {
        id: 'trigger-default',
        routineId: 'task-default',
        type: 'interval',
        config: { every: 2, unit: 'fortnights' },
      },
    ];

    selectChain.where.mockResolvedValueOnce(
      triggerDefinitions.map((trigger) => ({
        trigger: {
          ...trigger,
          nextRunAt: null,
        },
        taskStatus: 'idle',
      })),
    );

    await (service as any).doScan();

    expect(executor.triggerExecution).toHaveBeenCalledTimes(
      triggerDefinitions.length,
    );
    expect(updateChain.set).toHaveBeenNthCalledWith(1, {
      nextRunAt: new Date('2026-04-02T10:01:00.000Z'),
      lastRunAt: new Date('2026-04-02T10:00:00.000Z'),
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
    expect(updateChain.set).toHaveBeenNthCalledWith(2, {
      nextRunAt: new Date('2026-04-02T12:00:00.000Z'),
      lastRunAt: new Date('2026-04-02T10:00:00.000Z'),
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
    expect(updateChain.set).toHaveBeenNthCalledWith(3, {
      nextRunAt: new Date('2026-04-05T10:00:00.000Z'),
      lastRunAt: new Date('2026-04-02T10:00:00.000Z'),
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
    expect(updateChain.set).toHaveBeenNthCalledWith(4, {
      nextRunAt: new Date('2026-04-09T10:00:00.000Z'),
      lastRunAt: new Date('2026-04-02T10:00:00.000Z'),
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
    expect(updateChain.set).toHaveBeenNthCalledWith(5, {
      nextRunAt: new Date('2026-05-02T10:00:00.000Z'),
      lastRunAt: new Date('2026-04-02T10:00:00.000Z'),
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
    expect(updateChain.set).toHaveBeenNthCalledWith(6, {
      nextRunAt: new Date('2027-04-02T10:00:00.000Z'),
      lastRunAt: new Date('2026-04-02T10:00:00.000Z'),
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
    expect(updateChain.set).toHaveBeenNthCalledWith(7, {
      nextRunAt: new Date('2026-04-04T10:00:00.000Z'),
      lastRunAt: new Date('2026-04-02T10:00:00.000Z'),
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
  });
});
