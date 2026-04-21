import { describe, it, expect, jest } from '@jest/globals';
import { bootstrapWithSchemaRetry } from '@team9/shared';

function createSleep() {
  return jest.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
}

function makeUndefinedRelationError(): Error {
  return Object.assign(new Error('undefined relation'), {
    cause: { code: '42P01' },
  });
}

describe('bootstrapWithSchemaRetry', () => {
  it('resolves without retrying when bootstrap succeeds on the first try', async () => {
    const bootstrap = jest.fn<() => Promise<void>>().mockResolvedValue();
    const sleep = createSleep();

    await bootstrapWithSchemaRetry(bootstrap, { sleep });

    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries bootstrap when it fails with 42P01 and eventually succeeds', async () => {
    const warn = jest.fn<(msg: string) => void>();
    const sleep = createSleep();
    const bootstrap = jest
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(makeUndefinedRelationError())
      .mockRejectedValueOnce(makeUndefinedRelationError())
      .mockResolvedValueOnce(undefined);

    await bootstrapWithSchemaRetry(bootstrap, {
      sleep,
      logger: { warn },
    });

    expect(bootstrap).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(sleep).toHaveBeenNthCalledWith(2, 2000);
  });

  it('recognises the 42P01 code on the top-level error (no cause wrapper)', async () => {
    const sleep = createSleep();
    const flatError = Object.assign(new Error('undefined relation'), {
      code: '42P01',
    });
    const bootstrap = jest
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(flatError)
      .mockResolvedValueOnce(undefined);

    await bootstrapWithSchemaRetry(bootstrap, { sleep });

    expect(bootstrap).toHaveBeenCalledTimes(2);
  });

  it('rethrows immediately for errors unrelated to missing schema', async () => {
    const sleep = createSleep();
    const bootstrap = jest
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error('connection refused'));

    await expect(
      bootstrapWithSchemaRetry(bootstrap, { sleep }),
    ).rejects.toThrow('connection refused');

    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('throws after exhausting every retry attempt when schema never appears', async () => {
    const sleep = createSleep();
    const terminalError = makeUndefinedRelationError();
    const bootstrap = jest
      .fn<() => Promise<void>>()
      .mockRejectedValue(terminalError);

    await expect(bootstrapWithSchemaRetry(bootstrap, { sleep })).rejects.toBe(
      terminalError,
    );

    // 10 attempts total → 9 backoff sleeps.
    expect(bootstrap).toHaveBeenCalledTimes(10);
    expect(sleep).toHaveBeenCalledTimes(9);
    // Exponential backoff, capped at 15s.
    const delays = sleep.mock.calls.map((c) => c[0]);
    expect(delays).toEqual([
      1000, 2000, 4000, 8000, 15000, 15000, 15000, 15000, 15000,
    ]);
  });

  it('honours custom retry config overrides', async () => {
    const sleep = createSleep();
    const bootstrap = jest
      .fn<() => Promise<void>>()
      .mockRejectedValue(makeUndefinedRelationError());

    await expect(
      bootstrapWithSchemaRetry(bootstrap, {
        sleep,
        maxAttempts: 3,
        baseMs: 100,
        maxMs: 200,
      }),
    ).rejects.toBeDefined();

    expect(bootstrap).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
  });
});
