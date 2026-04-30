import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { appMetrics } from '@team9/observability';

import {
  RoutinesFolderIdNullSampler,
  DEFAULT_SAMPLE_INTERVAL_MS,
} from '../routines-folder-id-null.sampler.js';

// ── helpers ──────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

function makeDb(initialCount = 0) {
  const state = { count: initialCount };
  const execute: MockFn = jest.fn<any>(async () => [{ count: state.count }]);
  return {
    execute,
    __state: state,
  };
}

// ── tests ────────────────────────────────────────────────────────────

describe('RoutinesFolderIdNullSampler', () => {
  let counterAdd: MockFn;

  beforeEach(() => {
    jest.useFakeTimers();
    counterAdd = jest.fn<any>();
    jest
      .spyOn(appMetrics, 'routinesFolderIdNullTotal', 'get')
      .mockReturnValue({ add: counterAdd } as any);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('first sample: emits the full count as a positive delta from the assumed-zero baseline', async () => {
    const db = makeDb(7);
    const sampler = new RoutinesFolderIdNullSampler(db as any);

    await sampler.sample();

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(counterAdd).toHaveBeenCalledTimes(1);
    expect(counterAdd).toHaveBeenCalledWith(7);
  });

  it('subsequent sample emits a delta against the previous reading (decreasing)', async () => {
    const db = makeDb(10);
    const sampler = new RoutinesFolderIdNullSampler(db as any);

    await sampler.sample(); // emits +10
    db.__state.count = 4;
    await sampler.sample(); // expect -6

    expect(counterAdd).toHaveBeenNthCalledWith(1, 10);
    expect(counterAdd).toHaveBeenNthCalledWith(2, -6);
  });

  it('does NOT emit when the count is unchanged between samples', async () => {
    const db = makeDb(5);
    const sampler = new RoutinesFolderIdNullSampler(db as any);

    await sampler.sample(); // +5
    await sampler.sample(); // 0 delta — no emit

    expect(counterAdd).toHaveBeenCalledTimes(1);
  });

  it('handles the migration completing — emits delta down to 0 and stops', async () => {
    const db = makeDb(3);
    const sampler = new RoutinesFolderIdNullSampler(db as any);

    await sampler.sample(); // +3
    db.__state.count = 0;
    await sampler.sample(); // -3
    await sampler.sample(); // 0 delta

    expect(counterAdd).toHaveBeenNthCalledWith(1, 3);
    expect(counterAdd).toHaveBeenNthCalledWith(2, -3);
    expect(counterAdd).toHaveBeenCalledTimes(2);
  });

  it('survives DB errors (logs + skips, never propagates)', async () => {
    const db = {
      execute: jest.fn<any>(async () => {
        throw new Error('db down');
      }),
    };
    const sampler = new RoutinesFolderIdNullSampler(db as any);
    const loggerWarn = jest
      .spyOn((sampler as any).logger, 'warn')
      .mockImplementation(() => undefined);

    // sample() must NOT throw — observability is non-fatal.
    await expect(sampler.sample()).resolves.toBeUndefined();

    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('routines.folder_id_null_total sample failed'),
    );
    expect(counterAdd).not.toHaveBeenCalled();
  });

  it('handles non-Error throwables gracefully', async () => {
    // The catch branch in sample() stringifies a non-Error throwable via
    // `String(err)`. To exercise that path without tripping the
    // `@typescript-eslint/prefer-promise-reject-errors` lint rule (which
    // forbids rejecting with a string literal), wrap a non-string in an
    // object literal that has neither a `.message` property nor an
    // Error prototype. That goes through the same `else` branch.
    const nonError = { kind: 'unexpected-shape' } as unknown as Error;
    const db = {
      execute: jest.fn<any>(() => Promise.reject(nonError)),
    };
    const sampler = new RoutinesFolderIdNullSampler(db as any);
    const loggerWarn = jest
      .spyOn((sampler as any).logger, 'warn')
      .mockImplementation(() => undefined);

    await expect(sampler.sample()).resolves.toBeUndefined();
    expect(loggerWarn).toHaveBeenCalled();
  });

  it('treats an empty result row as count=0 (defensive)', async () => {
    const db = {
      execute: jest.fn<any>(async () => []),
    };
    const sampler = new RoutinesFolderIdNullSampler(db as any);

    await sampler.sample();
    // Initial baseline is 0, current is 0 → no emit (delta == 0).
    expect(counterAdd).not.toHaveBeenCalled();
  });

  describe('lifecycle', () => {
    it('onModuleInit kicks off an immediate sample and schedules the recurring timer', async () => {
      const db = makeDb(1);
      const sampler = new RoutinesFolderIdNullSampler(db as any);

      sampler.onModuleInit();
      // Immediate sample is `void`-fired in the same tick — flush microtasks
      // so the call lands before assertions.
      await Promise.resolve();
      await Promise.resolve();

      expect(db.execute).toHaveBeenCalledTimes(1);

      // Advance fake time by one interval; second sample should fire.
      db.__state.count = 2;
      jest.advanceTimersByTime(DEFAULT_SAMPLE_INTERVAL_MS);
      await Promise.resolve();
      await Promise.resolve();

      expect(db.execute).toHaveBeenCalledTimes(2);
      sampler.onModuleDestroy();
    });

    it('onModuleDestroy clears the timer (no further samples fire)', async () => {
      const db = makeDb(1);
      const sampler = new RoutinesFolderIdNullSampler(db as any);

      sampler.onModuleInit();
      await Promise.resolve();
      await Promise.resolve();
      const callsAfterInit = db.execute.mock.calls.length;

      sampler.onModuleDestroy();
      jest.advanceTimersByTime(DEFAULT_SAMPLE_INTERVAL_MS * 5);
      await Promise.resolve();

      // No new samples after destroy.
      expect(db.execute.mock.calls.length).toBe(callsAfterInit);
    });

    it('onModuleDestroy is idempotent (safe to call without onModuleInit)', () => {
      const db = makeDb(0);
      const sampler = new RoutinesFolderIdNullSampler(db as any);

      // No throw, no leak.
      expect(() => sampler.onModuleDestroy()).not.toThrow();
    });
  });
});
