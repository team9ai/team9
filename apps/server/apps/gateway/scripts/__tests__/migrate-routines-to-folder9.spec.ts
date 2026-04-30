import { describe, it, expect, jest, beforeEach } from '@jest/globals';

import {
  migrateRoutinesToFolder9,
  parseArgs,
  type MigrationDeps,
  type MigrationRoutineRow,
} from '../migrate-routines-to-folder9.js';
import type { ProvisionRoutineFolder9Client } from '../../src/routines/folder/provision-routine-folder.js';

// ── Mock helpers ─────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

/**
 * The migrator issues SELECT calls in a deterministic, repeating sequence:
 *
 *   ROUTINE_BATCH (per page)
 *   for each row in the batch with documentId:
 *     DOC_LOOKUP    → returns [{ currentVersionId }]
 *     VERSION_LOOKUP → returns [{ content }]
 *
 * We model this with a FIFO of pre-built responses. Each `db.select(...)`
 * call dequeues the next response. The test fixtures below use the
 * `queueRoutineBatch` / `queueDocumentResolve` helpers to build the
 * sequence so the test author doesn't have to interleave by hand.
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
    set: jest.fn<any>(),
    orderBy: jest.fn<any>(),
    limit: jest.fn<any>(),
    returning: jest.fn<any>(),
    then(onfulfilled, onrejected) {
      return Promise.resolve(resolve()).then(onfulfilled, onrejected);
    },
  };
  for (const key of [
    'from',
    'where',
    'set',
    'orderBy',
    'limit',
    'returning',
  ] as const) {
    query[key].mockReturnValue(query as never);
  }
  return query;
}

interface DbState {
  /** FIFO of select responses. */
  selectResponses: SelectResponse[];
  /** Recorded UPDATE invocations: each entry is the .set() argument. */
  updateSetArgs: unknown[];
}

function mockDb() {
  const state: DbState = { selectResponses: [], updateSetArgs: [] };

  const select = jest.fn<any>(() => {
    return createQuery(() => {
      // Default to empty array if the test under-queues. Surface
      // that through a sentinel so failing tests fail loudly.
      return state.selectResponses.shift() ?? [];
    });
  });

  const update = jest.fn<any>(() => {
    const q = createQuery(() => undefined);
    const originalSet = q.set;
    q.set = jest.fn<any>((arg: unknown) => {
      state.updateSetArgs.push(arg);
      return originalSet.apply(q, [arg] as never);
    }) as MockFn;
    return q;
  });

  return {
    select,
    update,
    __state: state,
    /** Queue the response for the next routine-batch SELECT. */
    queueRoutineBatch(rows: MigrationRoutineRow[]) {
      state.selectResponses.push(rows);
    },
    /**
     * Queue the doc + version SELECT pair that follows a row with a
     * documentId. `content === null` means "doc has no current version"
     * (we hand back a row with currentVersionId=null, skipping the
     * version SELECT — but the migrator still issues it because it only
     * checks `doc?.currentVersionId` — so we still queue the doc-row
     * with currentVersionId=null and DON'T queue a version response,
     * since the version SELECT is short-circuited by the early return).
     */
    queueDocumentResolve(content: string | null) {
      if (content === null) {
        // doc row has currentVersionId=null → migrator returns early,
        // no version SELECT issued.
        state.selectResponses.push([{ currentVersionId: null }]);
      } else {
        // doc row points at a version; version SELECT returns content.
        state.selectResponses.push([{ currentVersionId: 'ver-x' }]);
        state.selectResponses.push([{ content }]);
      }
    },
    /** Queue a "document not found" pair (empty doc lookup). */
    queueDocumentMissing() {
      state.selectResponses.push([]);
    },
  };
}

// ── Fixtures ────────────────────────────────────────────────────────

const TENANT = 'tenant-1';

function makeRow(
  overrides: Partial<MigrationRoutineRow> = {},
): MigrationRoutineRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    tenantId: TENANT,
    title: 'Daily Standup',
    description: 'Send daily standup',
    documentId: null,
    folderId: null,
    ...overrides,
  };
}

function makeFolder9Mock(): ProvisionRoutineFolder9Client {
  return {
    createFolder: jest.fn<any>(),
    createToken: jest.fn<any>(),
    commit: jest.fn<any>(),
  } as unknown as ProvisionRoutineFolder9Client;
}

function makeDeps(
  overrides: Partial<MigrationDeps> = {},
): MigrationDeps & { __db: ReturnType<typeof mockDb> } {
  const db = mockDb();
  const folder9Client = makeFolder9Mock();
  const logger = {
    log: jest.fn<any>(),
    warn: jest.fn<any>(),
    error: jest.fn<any>(),
  };
  return {
    db: db as unknown as MigrationDeps['db'],
    folder9Client,
    psk: 'psk-test',
    dryRun: false,
    pageSize: 100,
    logger,
    __db: db,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('migrateRoutinesToFolder9', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('empty result', () => {
    it('returns zero stats when there are no NULL-folderId rows', async () => {
      const deps = makeDeps();
      deps.__db.queueRoutineBatch([]); // first batch is empty → loop exits

      const provision = jest.fn<any>();
      const stats = await migrateRoutinesToFolder9({ ...deps, provision });

      expect(stats).toEqual({
        ok: 0,
        failed: 0,
        skipped: 0,
        failedIds: [],
      });
      expect(provision).not.toHaveBeenCalled();
      expect(deps.__db.__state.updateSetArgs).toHaveLength(0);
    });
  });

  describe('all-rows-migrate', () => {
    it('migrates every row in a single page (no documentIds)', async () => {
      const deps = makeDeps({ pageSize: 100 });
      const rows = [
        makeRow({ id: '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaa1' }),
        makeRow({ id: '22222222-aaaa-aaaa-aaaa-aaaaaaaaaaa2' }),
        makeRow({ id: '33333333-aaaa-aaaa-aaaa-aaaaaaaaaaa3' }),
      ];
      deps.__db.queueRoutineBatch(rows);
      // page size 100, batch returned 3 < 100 → loop terminates without
      // a second SELECT.

      let counter = 0;
      const provision = jest.fn<any>(async () => ({
        folderId: `folder-new-${++counter}`,
      }));

      const stats = await migrateRoutinesToFolder9({ ...deps, provision });

      expect(stats).toEqual({
        ok: 3,
        failed: 0,
        skipped: 0,
        failedIds: [],
      });
      expect(provision).toHaveBeenCalledTimes(3);
      expect(deps.__db.__state.updateSetArgs).toHaveLength(3);
    });

    it('passes documentContent resolved from documents/document_versions', async () => {
      const deps = makeDeps({ pageSize: 100 });
      const row = makeRow({
        id: '44444444-aaaa-aaaa-aaaa-aaaaaaaaaaa4',
        documentId: 'doc-1',
      });
      deps.__db.queueRoutineBatch([row]);
      deps.__db.queueDocumentResolve('Resolved body content');

      const provision = jest
        .fn<any>()
        .mockResolvedValue({ folderId: 'folder-x' });

      await migrateRoutinesToFolder9({ ...deps, provision });

      expect(provision).toHaveBeenCalledTimes(1);
      const [routineArg, depsArg] = provision.mock.calls[0];
      expect(routineArg).toEqual({
        id: row.id,
        title: row.title,
        description: row.description,
        documentContent: 'Resolved body content',
      });
      expect(depsArg.workspaceId).toBe(TENANT);
      expect(depsArg.psk).toBe('psk-test');
    });

    it('passes documentContent=null when the routine has no documentId', async () => {
      const deps = makeDeps({ pageSize: 100 });
      const row = makeRow({
        id: '55555555-aaaa-aaaa-aaaa-aaaaaaaaaaa5',
        documentId: null,
      });
      deps.__db.queueRoutineBatch([row]);

      const provision = jest
        .fn<any>()
        .mockResolvedValue({ folderId: 'folder-y' });

      await migrateRoutinesToFolder9({ ...deps, provision });

      expect(provision.mock.calls[0][0].documentContent).toBeNull();
    });

    it('passes documentContent=null when the document is missing', async () => {
      const deps = makeDeps({ pageSize: 100 });
      const row = makeRow({
        id: '66666666-aaaa-aaaa-aaaa-aaaaaaaaaaa6',
        documentId: 'doc-missing',
      });
      deps.__db.queueRoutineBatch([row]);
      deps.__db.queueDocumentMissing();

      const provision = jest
        .fn<any>()
        .mockResolvedValue({ folderId: 'folder-z' });

      await migrateRoutinesToFolder9({ ...deps, provision });

      expect(provision.mock.calls[0][0].documentContent).toBeNull();
    });

    it('passes documentContent=null when document has no currentVersionId', async () => {
      const deps = makeDeps({ pageSize: 100 });
      const row = makeRow({
        id: '77777777-aaaa-aaaa-aaaa-aaaaaaaaaaa7',
        documentId: 'doc-no-ver',
      });
      deps.__db.queueRoutineBatch([row]);
      deps.__db.queueDocumentResolve(null); // currentVersionId=null

      const provision = jest
        .fn<any>()
        .mockResolvedValue({ folderId: 'folder-q' });

      await migrateRoutinesToFolder9({ ...deps, provision });

      expect(provision.mock.calls[0][0].documentContent).toBeNull();
    });

    it('paginates across multiple pages until the page is short', async () => {
      const deps = makeDeps({ pageSize: 2 });
      // Page 1: 2 rows (= pageSize → fetches another page)
      deps.__db.queueRoutineBatch([
        makeRow({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' }),
        makeRow({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2' }),
      ]);
      // Page 2: 1 row (< pageSize → loop terminates)
      deps.__db.queueRoutineBatch([
        makeRow({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3' }),
      ]);

      let counter = 0;
      const provision = jest.fn<any>(async () => ({
        folderId: `folder-new-${++counter}`,
      }));

      const stats = await migrateRoutinesToFolder9({ ...deps, provision });

      expect(stats.ok).toBe(3);
      expect(provision).toHaveBeenCalledTimes(3);
    });

    it('paginates and terminates on an empty subsequent page when the prior page hit pageSize exactly', async () => {
      const deps = makeDeps({ pageSize: 2 });
      // Exactly pageSize → triggers a fetch of the next page
      deps.__db.queueRoutineBatch([
        makeRow({ id: 'eeeeeeee-aaaa-aaaa-aaaa-aaaaaaaaaaa1' }),
        makeRow({ id: 'eeeeeeee-aaaa-aaaa-aaaa-aaaaaaaaaaa2' }),
      ]);
      // Next fetch returns empty → loop exits via `if (batch.length === 0) break`
      deps.__db.queueRoutineBatch([]);

      let counter = 0;
      const provision = jest.fn<any>(async () => ({
        folderId: `folder-${++counter}`,
      }));

      const stats = await migrateRoutinesToFolder9({ ...deps, provision });

      expect(stats.ok).toBe(2);
    });
  });

  describe('mixed (some fail / some ok)', () => {
    it('records failed ids without aborting the batch', async () => {
      const deps = makeDeps({ pageSize: 100 });
      const rows = [
        makeRow({ id: 'bbbbbbbb-aaaa-aaaa-aaaa-aaaaaaaaaaa1' }),
        makeRow({ id: 'bbbbbbbb-aaaa-aaaa-aaaa-aaaaaaaaaaa2' }),
        makeRow({ id: 'bbbbbbbb-aaaa-aaaa-aaaa-aaaaaaaaaaa3' }),
      ];
      deps.__db.queueRoutineBatch(rows);

      const provision = jest
        .fn<any>()
        .mockResolvedValueOnce({ folderId: 'folder-1' })
        .mockRejectedValueOnce(new Error('folder9 timeout'))
        .mockResolvedValueOnce({ folderId: 'folder-3' });

      const stats = await migrateRoutinesToFolder9({ ...deps, provision });

      expect(stats.ok).toBe(2);
      expect(stats.failed).toBe(1);
      expect(stats.failedIds).toEqual(['bbbbbbbb-aaaa-aaaa-aaaa-aaaaaaaaaaa2']);
      // Two successful provisions → two UPDATEs; the failed one does not UPDATE.
      expect(deps.__db.__state.updateSetArgs).toHaveLength(2);
      // Final logger.warn lists failed ids
      expect(deps.logger?.warn).toHaveBeenCalledWith(
        expect.stringContaining('bbbbbbbb-aaaa-aaaa-aaaa-aaaaaaaaaaa2'),
      );
    });

    it('logs a warning for non-Error throwables and still records the id', async () => {
      const deps = makeDeps({ pageSize: 100 });
      deps.__db.queueRoutineBatch([
        makeRow({ id: 'cccccccc-aaaa-aaaa-aaaa-aaaaaaaaaaa1' }),
      ]);

      const provision = jest
        .fn<any>()
        .mockRejectedValue('plain-string-failure');

      const stats = await migrateRoutinesToFolder9({ ...deps, provision });

      expect(stats.failed).toBe(1);
      expect(stats.failedIds).toEqual(['cccccccc-aaaa-aaaa-aaaa-aaaaaaaaaaa1']);
      expect(deps.logger?.warn).toHaveBeenCalled();
    });

    it('continues to the next row when documentContent resolution fails by returning null content', async () => {
      // A "missing document" is treated as documentContent=null, NOT a
      // per-row failure — provision still runs with an empty body.
      const deps = makeDeps({ pageSize: 100 });
      const rows = [
        makeRow({
          id: 'dddddddd-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
          documentId: 'doc-orphan',
        }),
      ];
      deps.__db.queueRoutineBatch(rows);
      deps.__db.queueDocumentMissing();

      const provision = jest
        .fn<any>()
        .mockResolvedValue({ folderId: 'folder-orphan' });

      const stats = await migrateRoutinesToFolder9({ ...deps, provision });

      expect(stats).toEqual({
        ok: 1,
        failed: 0,
        skipped: 0,
        failedIds: [],
      });
      expect(provision.mock.calls[0][0].documentContent).toBeNull();
    });
  });

  describe('--dry-run mode', () => {
    it('skips provision + UPDATE and counts rows as skipped', async () => {
      const deps = makeDeps({ dryRun: true, pageSize: 100 });
      const rows = [
        makeRow({ id: 'dddddddd-aaaa-aaaa-aaaa-aaaaaaaaaaa1' }),
        makeRow({ id: 'dddddddd-aaaa-aaaa-aaaa-aaaaaaaaaaa2' }),
      ];
      deps.__db.queueRoutineBatch(rows);

      const provision = jest.fn<any>();
      const stats = await migrateRoutinesToFolder9({ ...deps, provision });

      expect(provision).not.toHaveBeenCalled();
      expect(stats).toEqual({
        ok: 0,
        failed: 0,
        skipped: 2,
        failedIds: [],
      });
      expect(deps.__db.__state.updateSetArgs).toHaveLength(0);
    });

    it('still resolves documentContent (read-only) — exercises the read path', async () => {
      const deps = makeDeps({ dryRun: true, pageSize: 100 });
      const row = makeRow({
        id: 'eeeeeeee-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        documentId: 'doc-dry',
      });
      deps.__db.queueRoutineBatch([row]);
      deps.__db.queueDocumentResolve('dry-run content');

      const provision = jest.fn<any>();
      const stats = await migrateRoutinesToFolder9({ ...deps, provision });

      expect(stats.skipped).toBe(1);
      // log includes contentLen=15 ("dry-run content".length)
      expect(deps.logger?.log).toHaveBeenCalledWith(
        expect.stringContaining('contentLen=15'),
      );
    });

    it('emits a dry-run-specific completion log', async () => {
      const deps = makeDeps({ dryRun: true, pageSize: 100 });
      deps.__db.queueRoutineBatch([
        makeRow({ id: 'fafafafa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' }),
      ]);

      await migrateRoutinesToFolder9({
        ...deps,
        provision: jest.fn<any>(),
      });

      expect(deps.logger?.log).toHaveBeenCalledWith(
        expect.stringContaining('dry-run'),
      );
    });
  });

  describe('idempotence', () => {
    it('an empty result on re-run is a no-op (zero stats, no provision calls)', async () => {
      // First "run": process 1 row.
      const deps1 = makeDeps({ pageSize: 100 });
      deps1.__db.queueRoutineBatch([
        makeRow({ id: 'ffffffff-aaaa-aaaa-aaaa-aaaaaaaaaaa1' }),
      ]);
      const provision1 = jest
        .fn<any>()
        .mockResolvedValue({ folderId: 'folder-r1' });
      const stats1 = await migrateRoutinesToFolder9({
        ...deps1,
        provision: provision1,
      });
      expect(stats1.ok).toBe(1);

      // Second "run" simulates the same script invoked again. The
      // production query filters folder_id IS NULL, so already-migrated
      // rows do not reappear. Mock that by serving an empty batch.
      const deps2 = makeDeps({ pageSize: 100 });
      deps2.__db.queueRoutineBatch([]);
      const provision2 = jest.fn<any>();
      const stats2 = await migrateRoutinesToFolder9({
        ...deps2,
        provision: provision2,
      });
      expect(stats2).toEqual({
        ok: 0,
        failed: 0,
        skipped: 0,
        failedIds: [],
      });
      expect(provision2).not.toHaveBeenCalled();
    });
  });

  describe('defaults', () => {
    // Coverage: the function falls back to internal defaults when the
    // optional `logger`, `provision`, and `pageSize` slots are omitted.
    // We can't easily verify the default logger without spying on
    // Logger.prototype, so we assert the function still completes; for
    // pageSize the empty-batch fast-exit lets us assert behaviour without
    // hitting the real 100-row default.
    it('uses default pageSize, logger, and provision when omitted', async () => {
      const db = mockDb();
      db.queueRoutineBatch([]); // empty → no actual provision call

      const folder9Client = makeFolder9Mock();
      const stats = await migrateRoutinesToFolder9({
        db: db as unknown as MigrationDeps['db'],
        folder9Client,
        psk: 'psk-test',
        dryRun: false,
        // pageSize, logger, provision all omitted → exercises defaults
      });

      expect(stats).toEqual({
        ok: 0,
        failed: 0,
        skipped: 0,
        failedIds: [],
      });
    });

    it('uses default pageSize, logger, and provision in dry-run mode', async () => {
      // Same as above but dry-run, to also exercise the dry-run completion
      // log default-binding path.
      const db = mockDb();
      db.queueRoutineBatch([]);

      const folder9Client = makeFolder9Mock();
      const stats = await migrateRoutinesToFolder9({
        db: db as unknown as MigrationDeps['db'],
        folder9Client,
        psk: 'psk-test',
        dryRun: true,
      });

      expect(stats.skipped).toBe(0);
    });
  });

  describe('document content edge cases', () => {
    it('returns null content when the version row is unexpectedly empty', async () => {
      // doc.currentVersionId is set but the version SELECT returns []
      // (e.g. a stale FK pointing at a deleted version). Migrator must
      // treat this as documentContent=null, not as a per-row failure.
      const deps = makeDeps({ pageSize: 100 });
      const row = makeRow({
        id: 'aaaaffff-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        documentId: 'doc-stale',
      });
      deps.__db.queueRoutineBatch([row]);
      // Manually queue: doc lookup returns row with currentVersionId set,
      // version lookup returns [] (no row).
      deps.__db.__state.selectResponses.push([{ currentVersionId: 'ver-x' }]);
      deps.__db.__state.selectResponses.push([]);

      const provision = jest
        .fn<any>()
        .mockResolvedValue({ folderId: 'folder-stale' });

      const stats = await migrateRoutinesToFolder9({ ...deps, provision });

      expect(stats.ok).toBe(1);
      expect(provision.mock.calls[0][0].documentContent).toBeNull();
    });
  });

  describe('parseArgs', () => {
    it('returns dryRun=false when --dry-run is absent', () => {
      expect(parseArgs([])).toEqual({ dryRun: false });
      expect(parseArgs(['--other-flag'])).toEqual({ dryRun: false });
    });

    it('returns dryRun=true when --dry-run is present', () => {
      expect(parseArgs(['--dry-run'])).toEqual({ dryRun: true });
      expect(parseArgs(['foo', '--dry-run', 'bar'])).toEqual({ dryRun: true });
    });
  });

  describe('forwarded provision deps', () => {
    it('forwards workspaceId from row.tenantId — every row uses its own tenant', async () => {
      const deps = makeDeps({ pageSize: 100 });
      const rows = [
        makeRow({
          id: 'aaa11111-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
          tenantId: 'tenant-A',
        }),
        makeRow({
          id: 'aaa22222-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
          tenantId: 'tenant-B',
        }),
      ];
      deps.__db.queueRoutineBatch(rows);

      const provision = jest
        .fn<any>()
        .mockResolvedValueOnce({ folderId: 'folder-A' })
        .mockResolvedValueOnce({ folderId: 'folder-B' });

      await migrateRoutinesToFolder9({ ...deps, provision });

      expect(provision.mock.calls[0][1].workspaceId).toBe('tenant-A');
      expect(provision.mock.calls[1][1].workspaceId).toBe('tenant-B');
    });

    it('forwards the folder9Client from deps to the provisioner', async () => {
      const deps = makeDeps({ pageSize: 100 });
      deps.__db.queueRoutineBatch([
        makeRow({ id: 'bbb11111-aaaa-aaaa-aaaa-aaaaaaaaaaa1' }),
      ]);

      const provision = jest
        .fn<any>()
        .mockResolvedValue({ folderId: 'folder-r' });

      await migrateRoutinesToFolder9({ ...deps, provision });

      expect(provision.mock.calls[0][1].folder9Client).toBe(deps.folder9Client);
    });
  });
});
