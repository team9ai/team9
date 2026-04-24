import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Logger } from '@nestjs/common';
import type { INestApplicationContext } from '@nestjs/common';
import { runBackfill } from '../backfill-public-wiki.js';
import { WikisService } from '../../wikis.service.js';
import { DATABASE_CONNECTION } from '@team9/database';

type MockFn = jest.Mock<(...args: any[]) => any>;

/**
 * Fluent drizzle chain where terminal methods (limit, etc.) resolve
 * per-call from an internal queue. Each chain is single-shot — the test
 * enqueues responses in the order the script awaits them.
 */
function makeDb() {
  const queue: any[] = [];
  const chain: Record<string, any> = {};

  const methods = ['select', 'from', 'where', 'limit'];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }

  // The first `await db.select()...from(schema.tenants)` doesn't call limit,
  // so `from` must be awaitable too. Make the chain thenable.
  chain.then = (resolve: (v: any) => void, reject?: (e: any) => void) => {
    const value = queue.length > 0 ? queue.shift() : [];
    return Promise.resolve(value).then(resolve, reject);
  };

  return {
    db: chain,
    enqueue: (value: any) => {
      queue.push(value);
    },
  };
}

function makeContext(
  overrides: Partial<{
    wikisService: { createWiki: MockFn };
    db: { select: MockFn };
    closeFn: MockFn;
  }> = {},
): {
  context: INestApplicationContext;
  wikisService: { createWiki: MockFn };
  db: ReturnType<typeof makeDb>;
  closeFn: MockFn;
} {
  const wikisService = overrides.wikisService ?? {
    createWiki: jest.fn<any>().mockResolvedValue({ id: 'wiki-id' }),
  };
  const dbPair = makeDb();
  const closeFn: MockFn =
    overrides.closeFn ?? jest.fn<any>().mockResolvedValue(undefined);

  const context: Partial<INestApplicationContext> = {
    get: jest.fn<any>().mockImplementation((token: any) => {
      if (token === WikisService) return wikisService;
      if (token === DATABASE_CONNECTION) return dbPair.db;
      throw new Error(`unexpected token: ${String(token)}`);
    }),
    close: closeFn,
  };

  return {
    context: context as INestApplicationContext,
    wikisService,
    db: dbPair,
    closeFn,
  };
}

// Silence Logger output during tests.
const silentLogger = new Logger('backfill-test');
(silentLogger as any).log = jest.fn();
(silentLogger as any).warn = jest.fn();
(silentLogger as any).error = jest.fn();
(silentLogger as any).debug = jest.fn();

describe('runBackfill', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a public wiki for workspaces that do not have one', async () => {
    const { context, wikisService, db, closeFn } = makeContext();

    // 1st await: list tenants
    db.enqueue([{ id: 'ws-1', name: 'WS One' }]);
    // 2nd: existing public wiki check (none)
    db.enqueue([]);
    // 3rd: owner lookup
    db.enqueue([{ userId: 'owner-1' }]);

    const stats = await runBackfill(async () => context, silentLogger);

    expect(stats).toEqual({
      total: 1,
      created: 1,
      skipped: 0,
      errored: 0,
    });
    expect(wikisService.createWiki).toHaveBeenCalledTimes(1);
    expect(wikisService.createWiki).toHaveBeenCalledWith(
      'ws-1',
      { id: 'owner-1', isAgent: false },
      { name: 'public', slug: 'public' },
    );
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: skips workspaces that already have a public wiki', async () => {
    const { context, wikisService, db, closeFn } = makeContext();

    db.enqueue([
      { id: 'ws-1', name: 'WS One' },
      { id: 'ws-2', name: 'WS Two' },
    ]);
    // ws-1 existing wiki check: found
    db.enqueue([{ id: 'existing-wiki-1' }]);
    // ws-2 existing wiki check: found
    db.enqueue([{ id: 'existing-wiki-2' }]);

    const stats = await runBackfill(async () => context, silentLogger);

    expect(stats).toEqual({
      total: 2,
      created: 0,
      skipped: 2,
      errored: 0,
    });
    expect(wikisService.createWiki).not.toHaveBeenCalled();
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  it('running twice is a no-op on the second pass', async () => {
    // First run — seeds one workspace.
    const first = makeContext();
    first.db.enqueue([{ id: 'ws-1', name: 'WS One' }]);
    first.db.enqueue([]); // no existing
    first.db.enqueue([{ userId: 'owner-1' }]);

    const firstStats = await runBackfill(
      async () => first.context,
      silentLogger,
    );
    expect(firstStats.created).toBe(1);
    expect(firstStats.skipped).toBe(0);

    // Second run — wiki now exists.
    const second = makeContext();
    second.db.enqueue([{ id: 'ws-1', name: 'WS One' }]);
    second.db.enqueue([{ id: 'existing-wiki-1' }]); // existing wiki found

    const secondStats = await runBackfill(
      async () => second.context,
      silentLogger,
    );
    expect(secondStats).toEqual({
      total: 1,
      created: 0,
      skipped: 1,
      errored: 0,
    });
    expect(second.wikisService.createWiki).not.toHaveBeenCalled();
  });

  it('skips workspaces without an owner', async () => {
    const { context, wikisService, db } = makeContext();

    db.enqueue([{ id: 'ws-orphan', name: 'Orphan WS' }]);
    db.enqueue([]); // no existing wiki
    db.enqueue([]); // no owner row

    const stats = await runBackfill(async () => context, silentLogger);

    expect(stats).toEqual({
      total: 1,
      created: 0,
      skipped: 1,
      errored: 0,
    });
    expect(wikisService.createWiki).not.toHaveBeenCalled();
  });

  it('continues past a per-workspace failure and records it in stats', async () => {
    const wikisService = {
      createWiki: jest
        .fn<any>()
        .mockRejectedValueOnce(new Error('folder9 unreachable'))
        .mockResolvedValueOnce({ id: 'wiki-2' }),
    };
    const { context, db } = makeContext({ wikisService });

    db.enqueue([
      { id: 'ws-1', name: 'WS One' },
      { id: 'ws-2', name: 'WS Two' },
    ]);
    // ws-1: no existing wiki, owner present, createWiki throws
    db.enqueue([]);
    db.enqueue([{ userId: 'owner-1' }]);
    // ws-2: no existing wiki, owner present, createWiki resolves
    db.enqueue([]);
    db.enqueue([{ userId: 'owner-2' }]);

    const stats = await runBackfill(async () => context, silentLogger);

    expect(stats).toEqual({
      total: 2,
      created: 1,
      skipped: 0,
      errored: 1,
    });
    expect(wikisService.createWiki).toHaveBeenCalledTimes(2);
  });

  it('continues when the existing-wiki check itself throws', async () => {
    const { context, wikisService, db } = makeContext();

    db.enqueue([{ id: 'ws-1', name: 'WS One' }]);
    // The existing-wiki check throws for ws-1.
    db.enqueue(Promise.reject(new Error('db connection lost')));

    const stats = await runBackfill(async () => context, silentLogger);

    expect(stats.errored).toBe(1);
    expect(stats.created).toBe(0);
    expect(stats.skipped).toBe(0);
    expect(wikisService.createWiki).not.toHaveBeenCalled();
  });

  it('records errors whose message is not an Error instance', async () => {
    const wikisService = {
      createWiki: jest.fn<any>().mockRejectedValueOnce('plain string failure'),
    };
    const { context, db } = makeContext({ wikisService });

    db.enqueue([{ id: 'ws-1', name: 'WS One' }]);
    db.enqueue([]);
    db.enqueue([{ userId: 'owner-1' }]);

    const stats = await runBackfill(async () => context, silentLogger);

    expect(stats.errored).toBe(1);
    expect(stats.created).toBe(0);
  });

  it('closes the Nest context even when the top-level tenant listing throws', async () => {
    const { context, closeFn, db } = makeContext();
    db.enqueue(Promise.reject(new Error('tenants query failed')));

    await expect(
      runBackfill(async () => context, silentLogger),
    ).rejects.toThrow('tenants query failed');

    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  it('uses the default logger when none is provided', async () => {
    const { context, db } = makeContext();
    db.enqueue([]);

    const stats = await runBackfill(async () => context);

    expect(stats).toEqual({
      total: 0,
      created: 0,
      skipped: 0,
      errored: 0,
    });
  });

  it('handles an empty workspace list', async () => {
    const { context, wikisService, db, closeFn } = makeContext();
    db.enqueue([]);

    const stats = await runBackfill(async () => context, silentLogger);

    expect(stats).toEqual({
      total: 0,
      created: 0,
      skipped: 0,
      errored: 0,
    });
    expect(wikisService.createWiki).not.toHaveBeenCalled();
    expect(closeFn).toHaveBeenCalledTimes(1);
  });
});
