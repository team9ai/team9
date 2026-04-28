import { describe, it, expect, jest, beforeEach } from '@jest/globals';

import {
  cleanupOrphanFolder9Routines,
  parseArgs,
  type CleanupDeps,
  type CleanupFolder9Client,
} from '../cleanup-orphan-folder9-routines.js';
import type { Folder9Folder } from '../../src/wikis/types/folder9.types.js';

// ── Mock helpers ─────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

/**
 * The cleanup script issues exactly two SELECTs in order:
 *
 *   1. select({folderId}) from routines where folderId IS NOT NULL
 *   2. selectDistinct({tenantId}) from routines
 *
 * We model the FIFO with a queue per "top-level call type" so tests can
 * arrange independently. Each `db.select(...)` and `db.selectDistinct(...)`
 * call dequeues the next response from its respective queue.
 */
type SelectResponse = unknown[];

function createQuery(resolve: () => unknown) {
  const query: Record<string, MockFn> & {
    then: (
      onfulfilled: (value: unknown) => unknown,
      onrejected?: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  } = {
    from: jest.fn<any>(),
    where: jest.fn<any>(),
    orderBy: jest.fn<any>(),
    limit: jest.fn<any>(),
    then(onfulfilled, onrejected) {
      return Promise.resolve(resolve()).then(onfulfilled, onrejected);
    },
  };
  for (const key of ['from', 'where', 'orderBy', 'limit'] as const) {
    query[key].mockReturnValue(query as never);
  }
  return query;
}

interface DbState {
  selectResponses: SelectResponse[];
  selectDistinctResponses: SelectResponse[];
}

function mockDb() {
  const state: DbState = { selectResponses: [], selectDistinctResponses: [] };

  const select = jest.fn<any>(() =>
    createQuery(() => state.selectResponses.shift() ?? []),
  );
  const selectDistinct = jest.fn<any>(() =>
    createQuery(() => state.selectDistinctResponses.shift() ?? []),
  );

  return {
    select,
    selectDistinct,
    __state: state,
    /** Queue the response for the next referenced-set SELECT. */
    queueReferenced(folderIds: (string | null)[]) {
      state.selectResponses.push(folderIds.map((folderId) => ({ folderId })));
    },
    /** Queue the response for the next distinct-tenant SELECT. */
    queueTenants(tenantIds: string[]) {
      state.selectDistinctResponses.push(
        tenantIds.map((tenantId) => ({ tenantId })),
      );
    },
  };
}

function makeFolder9Mock(): CleanupFolder9Client & {
  listFolders: MockFn;
  deleteFolder: MockFn;
} {
  return {
    listFolders: jest.fn<any>(),
    deleteFolder: jest.fn<any>(),
  } as unknown as CleanupFolder9Client & {
    listFolders: MockFn;
    deleteFolder: MockFn;
  };
}

const NOW = new Date('2026-04-27T12:00:00Z');

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

function makeFolder(overrides: Partial<Folder9Folder> = {}): Folder9Folder {
  return {
    id: 'f-default',
    name: 'routine-aaaaaaaa-bbbb',
    type: 'managed',
    owner_type: 'workspace',
    owner_id: 'tenant-1',
    workspace_id: 'tenant-1',
    approval_mode: 'auto',
    created_at: hoursAgo(48),
    updated_at: hoursAgo(48),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<CleanupDeps> = {}): CleanupDeps & {
  __db: ReturnType<typeof mockDb>;
  __folder9: ReturnType<typeof makeFolder9Mock>;
  __logger: { log: MockFn; warn: MockFn; error: MockFn };
} {
  const db = mockDb();
  const folder9Client = makeFolder9Mock();
  const logger = {
    log: jest.fn<any>(),
    warn: jest.fn<any>(),
    error: jest.fn<any>(),
  };
  return {
    db: db as unknown as CleanupDeps['db'],
    folder9Client,
    dryRun: false,
    now: () => NOW,
    logger,
    __db: db,
    __folder9: folder9Client,
    __logger: logger,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('cleanupOrphanFolder9Routines', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('no orphans', () => {
    it('returns zero stats when there are no tenants', async () => {
      const deps = makeDeps();
      deps.__db.queueReferenced([]);
      deps.__db.queueTenants([]);

      const stats = await cleanupOrphanFolder9Routines(deps);

      expect(stats).toEqual({
        deleted: 0,
        referenced: 0,
        recent: 0,
        failed: 0,
        failedIds: [],
        failedTenants: [],
      });
      expect(deps.__folder9.listFolders).not.toHaveBeenCalled();
      expect(deps.__folder9.deleteFolder).not.toHaveBeenCalled();
    });

    it('returns zero deleted when every routine-* folder is referenced', async () => {
      const deps = makeDeps();
      deps.__db.queueReferenced(['f-1', 'f-2']);
      deps.__db.queueTenants(['tenant-1']);

      deps.__folder9.listFolders.mockResolvedValue([
        makeFolder({ id: 'f-1', name: 'routine-aaaa-bbbb' }),
        makeFolder({ id: 'f-2', name: 'routine-cccc-dddd' }),
      ]);

      const stats = await cleanupOrphanFolder9Routines(deps);

      expect(stats.deleted).toBe(0);
      expect(stats.referenced).toBe(2);
      expect(stats.recent).toBe(0);
      expect(deps.__folder9.deleteFolder).not.toHaveBeenCalled();
    });

    it('ignores folders whose name does NOT start with "routine-"', async () => {
      const deps = makeDeps();
      deps.__db.queueReferenced([]);
      deps.__db.queueTenants(['tenant-1']);

      deps.__folder9.listFolders.mockResolvedValue([
        makeFolder({ id: 'f-wiki', name: 'wiki-aaaa-bbbb' }),
        makeFolder({ id: 'f-other', name: 'something-else' }),
      ]);

      const stats = await cleanupOrphanFolder9Routines(deps);

      expect(stats).toMatchObject({
        deleted: 0,
        referenced: 0,
        recent: 0,
        failed: 0,
      });
      expect(deps.__folder9.deleteFolder).not.toHaveBeenCalled();
    });
  });

  describe('mixed referenced / orphan', () => {
    it('deletes orphans and keeps referenced + recent folders', async () => {
      const deps = makeDeps();
      // f-keep is referenced; f-delete is an old orphan; f-recent is a
      // young orphan; f-wiki is non-routine and ignored.
      deps.__db.queueReferenced(['f-keep']);
      deps.__db.queueTenants(['tenant-1']);

      deps.__folder9.listFolders.mockResolvedValue([
        makeFolder({
          id: 'f-keep',
          name: 'routine-keep',
          created_at: hoursAgo(48),
        }),
        makeFolder({
          id: 'f-delete',
          name: 'routine-delete',
          created_at: hoursAgo(48),
        }),
        makeFolder({
          id: 'f-recent',
          name: 'routine-recent',
          created_at: hoursAgo(2),
        }),
        makeFolder({ id: 'f-wiki', name: 'wiki-other' }),
      ]);
      deps.__folder9.deleteFolder.mockResolvedValue(undefined);

      const stats = await cleanupOrphanFolder9Routines(deps);

      expect(stats.deleted).toBe(1);
      expect(stats.referenced).toBe(1);
      expect(stats.recent).toBe(1);
      expect(stats.failed).toBe(0);

      expect(deps.__folder9.deleteFolder).toHaveBeenCalledTimes(1);
      expect(deps.__folder9.deleteFolder).toHaveBeenCalledWith(
        'tenant-1',
        'f-delete',
      );
      // Per-deletion log line (not the summary).
      const logCalls = deps.__logger.log.mock.calls.map((c) => c[0]);
      expect(logCalls.some((l) => /deleted folder f-delete/.test(l))).toBe(
        true,
      );
    });

    it('sweeps multiple tenants and aggregates the stats', async () => {
      const deps = makeDeps();
      deps.__db.queueReferenced(['f-keep-A']);
      deps.__db.queueTenants(['tenant-A', 'tenant-B']);

      deps.__folder9.listFolders.mockImplementation(
        async (wsId: string): Promise<Folder9Folder[]> => {
          if (wsId === 'tenant-A') {
            return [
              makeFolder({
                id: 'f-keep-A',
                name: 'routine-A1',
                created_at: hoursAgo(48),
                workspace_id: 'tenant-A',
              }),
              makeFolder({
                id: 'f-orphan-A',
                name: 'routine-A2',
                created_at: hoursAgo(48),
                workspace_id: 'tenant-A',
              }),
            ];
          }
          if (wsId === 'tenant-B') {
            return [
              makeFolder({
                id: 'f-orphan-B',
                name: 'routine-B1',
                created_at: hoursAgo(72),
                workspace_id: 'tenant-B',
              }),
            ];
          }
          return [];
        },
      );
      deps.__folder9.deleteFolder.mockResolvedValue(undefined);

      const stats = await cleanupOrphanFolder9Routines(deps);

      expect(stats.deleted).toBe(2);
      expect(stats.referenced).toBe(1);
      expect(deps.__folder9.deleteFolder.mock.calls).toEqual(
        expect.arrayContaining([
          ['tenant-A', 'f-orphan-A'],
          ['tenant-B', 'f-orphan-B'],
        ]),
      );
    });
  });

  describe('threshold edge cases', () => {
    it('keeps a folder created exactly 23h ago (under the 24h grace)', async () => {
      const deps = makeDeps();
      deps.__db.queueReferenced([]);
      deps.__db.queueTenants(['tenant-1']);
      deps.__folder9.listFolders.mockResolvedValue([
        makeFolder({
          id: 'f-23h',
          name: 'routine-23h',
          created_at: hoursAgo(23),
        }),
      ]);

      const stats = await cleanupOrphanFolder9Routines(deps);

      expect(stats.recent).toBe(1);
      expect(stats.deleted).toBe(0);
      expect(deps.__folder9.deleteFolder).not.toHaveBeenCalled();
    });

    it('deletes a folder created 25h ago (past the 24h grace)', async () => {
      const deps = makeDeps();
      deps.__db.queueReferenced([]);
      deps.__db.queueTenants(['tenant-1']);
      deps.__folder9.listFolders.mockResolvedValue([
        makeFolder({
          id: 'f-25h',
          name: 'routine-25h',
          created_at: hoursAgo(25),
        }),
      ]);
      deps.__folder9.deleteFolder.mockResolvedValue(undefined);

      const stats = await cleanupOrphanFolder9Routines(deps);

      expect(stats.deleted).toBe(1);
      expect(stats.recent).toBe(0);
      expect(deps.__folder9.deleteFolder).toHaveBeenCalledWith(
        'tenant-1',
        'f-25h',
      );
    });

    it('keeps a folder created exactly at the 24h cutoff (boundary = recent)', async () => {
      // created_at == cutoff → createdAt >= cutoff → counted as "recent"
      const deps = makeDeps();
      deps.__db.queueReferenced([]);
      deps.__db.queueTenants(['tenant-1']);
      deps.__folder9.listFolders.mockResolvedValue([
        makeFolder({
          id: 'f-24h',
          name: 'routine-24h',
          created_at: hoursAgo(24),
        }),
      ]);

      const stats = await cleanupOrphanFolder9Routines(deps);

      expect(stats.recent).toBe(1);
      expect(stats.deleted).toBe(0);
    });

    it('respects a custom graceMs override', async () => {
      // graceMs=1h → folder 90 minutes old should now be deletable.
      const deps = makeDeps({ graceMs: 60 * 60_000 });
      deps.__db.queueReferenced([]);
      deps.__db.queueTenants(['tenant-1']);
      deps.__folder9.listFolders.mockResolvedValue([
        makeFolder({
          id: 'f-90m',
          name: 'routine-90m',
          created_at: hoursAgo(1.5),
        }),
      ]);
      deps.__folder9.deleteFolder.mockResolvedValue(undefined);

      const stats = await cleanupOrphanFolder9Routines(deps);

      expect(stats.deleted).toBe(1);
    });

    it('skips folders whose created_at is unparseable (defensive)', async () => {
      const deps = makeDeps();
      deps.__db.queueReferenced([]);
      deps.__db.queueTenants(['tenant-1']);
      deps.__folder9.listFolders.mockResolvedValue([
        makeFolder({
          id: 'f-bad-time',
          name: 'routine-bad-time',
          created_at: 'definitely-not-a-date',
        }),
      ]);

      const stats = await cleanupOrphanFolder9Routines(deps);

      expect(stats.deleted).toBe(0);
      expect(stats.recent).toBe(0);
      expect(stats.referenced).toBe(0);
      expect(deps.__folder9.deleteFolder).not.toHaveBeenCalled();
      expect(deps.__logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('unparseable created_at'),
      );
    });
  });

  describe('failure handling', () => {
    it('records the tenant and continues when listFolders throws', async () => {
      const deps = makeDeps();
      deps.__db.queueReferenced([]);
      deps.__db.queueTenants(['tenant-bad', 'tenant-good']);

      deps.__folder9.listFolders.mockImplementation(async (wsId: string) => {
        if (wsId === 'tenant-bad') throw new Error('folder9 down');
        return [
          makeFolder({
            id: 'f-orphan',
            name: 'routine-good',
            created_at: hoursAgo(48),
          }),
        ];
      });
      deps.__folder9.deleteFolder.mockResolvedValue(undefined);

      const stats = await cleanupOrphanFolder9Routines(deps);

      expect(stats.failedTenants).toEqual(['tenant-bad']);
      expect(stats.deleted).toBe(1);
      expect(deps.__folder9.deleteFolder).toHaveBeenCalledTimes(1);
      expect(deps.__folder9.deleteFolder).toHaveBeenCalledWith(
        'tenant-good',
        'f-orphan',
      );
      expect(deps.__logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('listFolders for tenant tenant-bad failed'),
      );
    });

    it('records the failed folder id and continues when deleteFolder throws', async () => {
      const deps = makeDeps();
      deps.__db.queueReferenced([]);
      deps.__db.queueTenants(['tenant-1']);

      deps.__folder9.listFolders.mockResolvedValue([
        makeFolder({
          id: 'f-fail',
          name: 'routine-fail',
          created_at: hoursAgo(48),
        }),
        makeFolder({
          id: 'f-ok',
          name: 'routine-ok',
          created_at: hoursAgo(48),
        }),
      ]);
      deps.__folder9.deleteFolder.mockImplementation(
        async (_ws: string, folderId: string) => {
          if (folderId === 'f-fail') throw new Error('folder9 conflict');
        },
      );

      const stats = await cleanupOrphanFolder9Routines(deps);

      expect(stats.failed).toBe(1);
      expect(stats.failedIds).toEqual(['f-fail']);
      expect(stats.deleted).toBe(1);
      // Both folders attempted — one failure does NOT abort the loop.
      expect(deps.__folder9.deleteFolder).toHaveBeenCalledTimes(2);
      expect(deps.__logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('failed folder ids: f-fail'),
      );
    });

    it('handles non-Error throwables (e.g. plain string)', async () => {
      const deps = makeDeps();
      deps.__db.queueReferenced([]);
      deps.__db.queueTenants(['tenant-1']);

      deps.__folder9.listFolders.mockResolvedValue([
        makeFolder({
          id: 'f-string-err',
          name: 'routine-string-err',
          created_at: hoursAgo(48),
        }),
      ]);
      deps.__folder9.deleteFolder.mockRejectedValue('string-failure');

      const stats = await cleanupOrphanFolder9Routines(deps);

      expect(stats.failed).toBe(1);
      expect(stats.failedIds).toEqual(['f-string-err']);
      expect(deps.__logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('string-failure'),
      );
    });

    it('handles non-Error listFolders throwables', async () => {
      const deps = makeDeps();
      deps.__db.queueReferenced([]);
      deps.__db.queueTenants(['tenant-bad']);
      deps.__folder9.listFolders.mockRejectedValue('list-string-failure');

      const stats = await cleanupOrphanFolder9Routines(deps);

      expect(stats.failedTenants).toEqual(['tenant-bad']);
      expect(deps.__logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('list-string-failure'),
      );
    });
  });

  describe('--dry-run mode', () => {
    it('skips deleteFolder but counts orphans as would-delete', async () => {
      const deps = makeDeps({ dryRun: true });
      deps.__db.queueReferenced(['f-keep']);
      deps.__db.queueTenants(['tenant-1']);

      deps.__folder9.listFolders.mockResolvedValue([
        makeFolder({
          id: 'f-keep',
          name: 'routine-keep',
          created_at: hoursAgo(48),
        }),
        makeFolder({
          id: 'f-orphan',
          name: 'routine-orphan',
          created_at: hoursAgo(48),
        }),
      ]);

      const stats = await cleanupOrphanFolder9Routines(deps);

      expect(deps.__folder9.deleteFolder).not.toHaveBeenCalled();
      expect(stats.deleted).toBe(1);
      expect(stats.referenced).toBe(1);
      // Per-folder dry-run log + final summary.
      expect(deps.__logger.log).toHaveBeenCalledWith(
        expect.stringContaining('[dry-run] would delete folder f-orphan'),
      );
      expect(deps.__logger.log).toHaveBeenCalledWith(
        expect.stringContaining('would-delete='),
      );
    });
  });

  describe('defaults', () => {
    it('uses default logger, now, and graceMs when omitted', async () => {
      const db = mockDb();
      db.queueReferenced([]);
      db.queueTenants([]);

      const folder9Client = makeFolder9Mock();
      const stats = await cleanupOrphanFolder9Routines({
        db: db as unknown as CleanupDeps['db'],
        folder9Client,
        dryRun: false,
        // logger, now, graceMs omitted → exercises defaults
      });

      expect(stats).toEqual({
        deleted: 0,
        referenced: 0,
        recent: 0,
        failed: 0,
        failedIds: [],
        failedTenants: [],
      });
    });
  });

  describe('referenced set edge cases', () => {
    it('ignores null folderId rows in the referenced set query', async () => {
      // Even though the query filters IS NOT NULL, defend against the
      // shape if drizzle ever returns a null defensively. The build-time
      // SQL guards us already; this makes the runtime guard explicit.
      const deps = makeDeps();
      deps.__db.queueReferenced([null, 'f-real']);
      deps.__db.queueTenants(['tenant-1']);
      deps.__folder9.listFolders.mockResolvedValue([
        makeFolder({
          id: 'f-real',
          name: 'routine-real',
          created_at: hoursAgo(48),
        }),
      ]);

      const stats = await cleanupOrphanFolder9Routines(deps);

      expect(stats.referenced).toBe(1);
      expect(stats.deleted).toBe(0);
    });
  });

  describe('parseArgs', () => {
    it('returns dryRun=false when --dry-run is absent', () => {
      expect(parseArgs([])).toEqual({ dryRun: false });
      expect(parseArgs(['--other'])).toEqual({ dryRun: false });
    });

    it('returns dryRun=true when --dry-run is present', () => {
      expect(parseArgs(['--dry-run'])).toEqual({ dryRun: true });
      expect(parseArgs(['foo', '--dry-run', 'bar'])).toEqual({ dryRun: true });
    });
  });
});
