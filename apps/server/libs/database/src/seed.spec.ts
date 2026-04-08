import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('runSeed', () => {
  let mockClient: any;
  let mockQuery: any;
  let mockEnd: any;

  beforeEach(() => {
    mockQuery = jest.fn();
    mockEnd = jest.fn();
    mockClient = {
      unsafe: jest.fn(),
      query: mockQuery,
      end: mockEnd,
    };
  });

  it('should bootstrap __seed_status table and insert default key on first run', async () => {
    jest.resetModules();

    jest.unstable_mockModule('postgres', () => ({
      default: jest.fn(() => mockClient),
    }));

    jest.unstable_mockModule('drizzle-orm/postgres-js', () => ({
      drizzle: jest.fn(() => ({})),
    }));

    const { runSeed } = await import('./seed.js');

    mockClient.unsafe
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await runSeed();

    expect(mockClient.unsafe).toHaveBeenCalled();
    expect(mockEnd).toHaveBeenCalled();
  });

  it('should use pg_advisory_xact_lock with magic number for concurrency safety', async () => {
    jest.resetModules();

    jest.unstable_mockModule('postgres', () => ({
      default: jest.fn(() => mockClient),
    }));

    jest.unstable_mockModule('drizzle-orm/postgres-js', () => ({
      drizzle: jest.fn(() => ({})),
    }));

    const { runSeed } = await import('./seed.js');

    mockClient.unsafe
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await runSeed();

    const unsafeCall = mockClient.unsafe.mock.calls.find((call: any[]) =>
      call[0]?.includes('pg_advisory_xact_lock'),
    );
    expect(unsafeCall).toBeDefined();
    if (unsafeCall) {
      expect(unsafeCall[0]).toMatch(/9172034501/);
    }
  });

  it('should skip inserting if default key already exists', async () => {
    jest.resetModules();

    jest.unstable_mockModule('postgres', () => ({
      default: jest.fn(() => mockClient),
    }));

    jest.unstable_mockModule('drizzle-orm/postgres-js', () => ({
      drizzle: jest.fn(() => ({})),
    }));

    const { runSeed } = await import('./seed.js');

    mockClient.unsafe
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ key: 'default' }]);

    await runSeed();

    const insertCall = mockClient.unsafe.mock.calls.find(
      (call: any[]) =>
        typeof call[0] === 'string' &&
        call[0].includes('INSERT INTO __seed_status'),
    );
    expect(insertCall).toBeUndefined();
  });

  it('should close the database connection in success path', async () => {
    jest.resetModules();

    jest.unstable_mockModule('postgres', () => ({
      default: jest.fn(() => mockClient),
    }));

    jest.unstable_mockModule('drizzle-orm/postgres-js', () => ({
      drizzle: jest.fn(() => ({})),
    }));

    const { runSeed } = await import('./seed.js');

    mockClient.unsafe
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await runSeed();

    expect(mockEnd).toHaveBeenCalled();
  });

  it('should close the database connection on error', async () => {
    jest.resetModules();

    jest.unstable_mockModule('postgres', () => ({
      default: jest.fn(() => mockClient),
    }));

    jest.unstable_mockModule('drizzle-orm/postgres-js', () => ({
      drizzle: jest.fn(() => ({})),
    }));

    const { runSeed } = await import('./seed.js');

    mockClient.unsafe.mockRejectedValueOnce(new Error('Test error'));

    try {
      await runSeed();
    } catch {
      // error is expected
    }

    expect(mockEnd).toHaveBeenCalled();
  });

  it('should propagate errors from the transaction body', async () => {
    jest.resetModules();

    jest.unstable_mockModule('postgres', () => ({
      default: jest.fn(() => mockClient),
    }));

    jest.unstable_mockModule('drizzle-orm/postgres-js', () => ({
      drizzle: jest.fn(() => ({})),
    }));

    const { runSeed } = await import('./seed.js');

    mockClient.unsafe.mockRejectedValueOnce(new Error('DB error'));

    await expect(runSeed()).rejects.toThrow('DB error');
  });
});
