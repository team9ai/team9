import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('runSeed', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('should bootstrap __seed_status table and insert default key on first run', async () => {
    const mockTxUnsafe = jest.fn();
    const mockBegin = jest.fn(async (callback) => {
      return callback({ unsafe: mockTxUnsafe });
    });
    const mockClientUnsafe = jest.fn();
    const mockEnd = jest.fn();

    const mockClient = {
      unsafe: mockClientUnsafe,
      begin: mockBegin,
      end: mockEnd,
    };

    jest.unstable_mockModule('postgres', () => ({
      default: jest.fn(() => mockClient),
    }));

    const { runSeed } = await import('./seed.js');

    mockClientUnsafe.mockResolvedValueOnce(undefined); // CREATE TABLE IF NOT EXISTS
    mockTxUnsafe
      .mockResolvedValueOnce(undefined) // pg_advisory_xact_lock
      .mockResolvedValueOnce([]); // SELECT (returns empty)
    mockTxUnsafe.mockResolvedValueOnce(undefined); // INSERT

    await runSeed();

    expect(mockClientUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS __seed_status'),
    );
    expect(mockBegin).toHaveBeenCalledTimes(1);
    expect(mockTxUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
    );
    expect(mockEnd).toHaveBeenCalled();
  });

  it('should skip insert when seed status already exists', async () => {
    const mockTxUnsafe = jest.fn();
    const mockBegin = jest.fn(async (callback) => {
      return callback({ unsafe: mockTxUnsafe });
    });
    const mockClientUnsafe = jest.fn();
    const mockEnd = jest.fn();

    const mockClient = {
      unsafe: mockClientUnsafe,
      begin: mockBegin,
      end: mockEnd,
    };

    jest.unstable_mockModule('postgres', () => ({
      default: jest.fn(() => mockClient),
    }));

    const { runSeed } = await import('./seed.js');

    mockClientUnsafe.mockResolvedValueOnce(undefined); // CREATE TABLE IF NOT EXISTS
    mockTxUnsafe
      .mockResolvedValueOnce(undefined) // pg_advisory_xact_lock
      .mockResolvedValueOnce([{ key: 'default' }]); // SELECT (returns existing)

    await runSeed();

    // Should not have called INSERT (only 2 tx.unsafe calls: lock + select)
    expect(mockTxUnsafe).toHaveBeenCalledTimes(2);
    expect(mockEnd).toHaveBeenCalled();
  });

  it('should close the database connection on success', async () => {
    const mockTxUnsafe = jest.fn();
    const mockBegin = jest.fn(async (callback) => {
      return callback({ unsafe: mockTxUnsafe });
    });
    const mockClientUnsafe = jest.fn();
    const mockEnd = jest.fn();

    const mockClient = {
      unsafe: mockClientUnsafe,
      begin: mockBegin,
      end: mockEnd,
    };

    jest.unstable_mockModule('postgres', () => ({
      default: jest.fn(() => mockClient),
    }));

    const { runSeed } = await import('./seed.js');

    mockClientUnsafe.mockResolvedValueOnce(undefined);
    mockTxUnsafe.mockResolvedValueOnce(undefined).mockResolvedValueOnce([]);

    await runSeed();

    expect(mockEnd).toHaveBeenCalled();
  });

  it('should close the database connection on error', async () => {
    const mockBegin = jest.fn(async () => {
      throw new Error('Transaction error');
    });
    const mockClientUnsafe = jest.fn();
    const mockEnd = jest.fn();

    const mockClient = {
      unsafe: mockClientUnsafe,
      begin: mockBegin,
      end: mockEnd,
    };

    jest.unstable_mockModule('postgres', () => ({
      default: jest.fn(() => mockClient),
    }));

    const { runSeed } = await import('./seed.js');

    mockClientUnsafe.mockResolvedValueOnce(undefined);

    try {
      await runSeed();
    } catch {
      // error is expected
    }

    expect(mockEnd).toHaveBeenCalled();
  });

  it('should propagate errors from transaction', async () => {
    const mockBegin = jest.fn(async () => {
      throw new Error('Transaction failed');
    });
    const mockClientUnsafe = jest.fn();
    const mockEnd = jest.fn();

    const mockClient = {
      unsafe: mockClientUnsafe,
      begin: mockBegin,
      end: mockEnd,
    };

    jest.unstable_mockModule('postgres', () => ({
      default: jest.fn(() => mockClient),
    }));

    const { runSeed } = await import('./seed.js');

    mockClientUnsafe.mockResolvedValueOnce(undefined);

    await expect(runSeed()).rejects.toThrow('Transaction failed');
  });
});
