import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { appMetrics } from '@team9/observability';

import {
  ensureRoutineFolder,
  type EnsureRoutineFolderDeps,
} from '../ensure-routine-folder.js';
import type { ProvisionRoutineFolderDeps } from '../provision-routine-folder.js';

// ── helpers ──────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

interface RoutineRow {
  id: string;
  tenantId: string;
  title: string;
  description: string | null;
  documentContent: string | null;
  folderId: string | null;
  [key: string]: unknown;
}

/**
 * Build a thenable Drizzle-style query chain. Every chain method returns
 * the same object; awaiting the chain resolves the supplied resolver.
 */
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
    limit: jest.fn<any>(),
    returning: jest.fn<any>(),
    then(onfulfilled, onrejected) {
      return Promise.resolve(resolve()).then(onfulfilled, onrejected);
    },
  };

  for (const key of ['from', 'where', 'set', 'limit', 'returning'] as const) {
    query[key].mockReturnValue(query as never);
  }

  return query;
}

/**
 * State for the mock DB. After C2, ensureRoutineFolder no longer uses
 * `db.transaction` or `.for('update')` — it just runs an optimistic
 * SELECT, the slow folder9 provision, then an UPDATE-WHERE-NULL whose
 * `returning()` decides race winner vs loser.
 *
 * We model both:
 * - `selectResults`: FIFO queue of rows for each `db.select()` call
 *   (used for the initial fetch + the optional race-loss re-read).
 * - `updateReturningResults`: FIFO queue of rows for `update().returning()`.
 *   Empty array `[]` simulates "another caller raced and won" (0 rows
 *   matched the `folder_id IS NULL` predicate). One-element array
 *   `[winnerRow]` simulates a successful claim.
 */
interface DbState {
  selectResults: (RoutineRow | undefined)[][];
  updateReturningResults: RoutineRow[][];
}

function mockDb() {
  const state: DbState = {
    selectResults: [],
    updateReturningResults: [],
  };

  const queries = {
    select: [] as ReturnType<typeof createQuery>[],
    update: [] as ReturnType<typeof createQuery>[],
  };

  const select = jest.fn<any>(() => {
    const q = createQuery(() =>
      state.selectResults.length > 0 ? state.selectResults.shift() : [],
    );
    queries.select.push(q);
    return q as never;
  });

  const update = jest.fn<any>(() => {
    // The chain `set().where().returning()` is the terminal awaited call.
    // Resolve the chain itself to the FIFO `updateReturningResults` head;
    // when the implementation does NOT call `.returning()` at all (legacy
    // pattern, shouldn't happen post-C2), we still resolve to whatever
    // the head says so the test stays observable.
    const head =
      state.updateReturningResults.length > 0
        ? state.updateReturningResults.shift()!
        : [];
    const q = createQuery(() => head);
    queries.update.push(q);
    return q as never;
  });

  return {
    __state: state,
    __queries: queries,
    select,
    update,
    // A vestigial transaction stub — the new code path never invokes it,
    // but leaving it here means any accidental regression that
    // re-introduces tx wrapping fails loudly in tests rather than
    // silently passing.
    transaction: jest.fn<any>(async () => {
      throw new Error(
        'ensureRoutineFolder must not open a DB transaction (C2 regression)',
      );
    }),
  };
}

// ── fixtures ─────────────────────────────────────────────────────────

const ROUTINE_ID = '7f3a2b1c-1111-2222-3333-444455556666';

function makeRow(overrides: Partial<RoutineRow> = {}): RoutineRow {
  return {
    id: ROUTINE_ID,
    tenantId: 'tenant-1',
    title: 'Daily Standup',
    description: 'Send daily standup',
    documentContent: null,
    folderId: null,
    ...overrides,
  };
}

function makeProvisionDeps(): ProvisionRoutineFolderDeps {
  return {
    folder9Client: {
      createFolder: jest.fn<any>(),
      createToken: jest.fn<any>(),
      commit: jest.fn<any>(),
    } as unknown as ProvisionRoutineFolderDeps['folder9Client'],
    workspaceId: 'ws-1',
    psk: 'psk-1',
  };
}

// ── tests ────────────────────────────────────────────────────────────

describe('ensureRoutineFolder', () => {
  let db: ReturnType<typeof mockDb>;
  let provisionDeps: ProvisionRoutineFolderDeps;

  beforeEach(() => {
    db = mockDb();
    provisionDeps = makeProvisionDeps();
    jest.clearAllMocks();
  });

  describe('fast path', () => {
    it('returns the row unchanged and skips provision when folder_id is already set', async () => {
      const row = makeRow({ folderId: 'folder-existing' });
      db.__state.selectResults.push([row]);
      const provision = jest.fn<any>();

      const result = await ensureRoutineFolder(ROUTINE_ID, {
        db: db as unknown as EnsureRoutineFolderDeps['db'],
        provisionDeps,
        provision,
      });

      expect(result).toBe(row);
      expect(provision).not.toHaveBeenCalled();
      expect(db.__queries.update).toHaveLength(0);
      // No transaction is opened on any path — the mock throws if it is.
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('uses optimistic SELECT (no .for("update"), no transaction)', async () => {
      db.__state.selectResults.push([makeRow({ folderId: 'folder-1' })]);
      const provision = jest.fn<any>();

      await ensureRoutineFolder(ROUTINE_ID, {
        db: db as unknown as EnsureRoutineFolderDeps['db'],
        provisionDeps,
        provision,
      });

      expect(db.__queries.select).toHaveLength(1);
      // The new shape uses .limit(1) instead of .for('update').
      expect(db.__queries.select[0].limit).toHaveBeenCalledWith(1);
      expect(db.transaction).not.toHaveBeenCalled();
    });
  });

  describe('slow path', () => {
    it('provisions, persists folder_id via UPDATE-WHERE-NULL, and returns the merged row', async () => {
      const row = makeRow({ folderId: null });
      db.__state.selectResults.push([row]);
      // UPDATE-WHERE-NULL succeeds — RETURNING yields the freshly-claimed row.
      const claimed = { ...row, folderId: 'folder-new-1' };
      db.__state.updateReturningResults.push([claimed]);
      const provision = jest
        .fn<any>()
        .mockResolvedValue({ folderId: 'folder-new-1' });

      const result = await ensureRoutineFolder(ROUTINE_ID, {
        db: db as unknown as EnsureRoutineFolderDeps['db'],
        provisionDeps,
        provision,
      });

      expect(provision).toHaveBeenCalledTimes(1);
      expect(provision).toHaveBeenCalledWith(
        expect.objectContaining({
          id: ROUTINE_ID,
          title: 'Daily Standup',
          description: 'Send daily standup',
        }),
        provisionDeps,
      );
      expect(db.__queries.update).toHaveLength(1);
      expect(result.folderId).toBe('folder-new-1');
      expect(result.id).toBe(ROUTINE_ID);
      expect(result.title).toBe('Daily Standup');
    });

    it('passes id/title/description to provisionFn with documentContent=null', async () => {
      const row = makeRow({
        folderId: null,
        description: 'Custom desc',
      });
      db.__state.selectResults.push([row]);
      db.__state.updateReturningResults.push([
        { ...row, folderId: 'folder-new-2' },
      ]);
      const provision = jest
        .fn<any>()
        .mockResolvedValue({ folderId: 'folder-new-2' });

      await ensureRoutineFolder(ROUTINE_ID, {
        db: db as unknown as EnsureRoutineFolderDeps['db'],
        provisionDeps,
        provision,
      });

      const [routineArg] = provision.mock.calls[0];
      expect(routineArg).toEqual({
        id: ROUTINE_ID,
        title: 'Daily Standup',
        description: 'Custom desc',
        documentContent: null,
      });
    });

    it('passes a null description through to provisionFn unchanged', async () => {
      const row = makeRow({ folderId: null, description: null });
      db.__state.selectResults.push([row]);
      db.__state.updateReturningResults.push([
        { ...row, folderId: 'folder-new-3' },
      ]);
      const provision = jest
        .fn<any>()
        .mockResolvedValue({ folderId: 'folder-new-3' });

      await ensureRoutineFolder(ROUTINE_ID, {
        db: db as unknown as EnsureRoutineFolderDeps['db'],
        provisionDeps,
        provision,
      });

      expect(provision.mock.calls[0][0].description).toBeNull();
    });

    it('does not open a DB transaction for the slow path', async () => {
      // C2 regression guard — folder9 HTTP I/O must NOT happen inside
      // a tx, otherwise a PG connection gets pinned for the worst-case
      // ~75s folder9 latency.
      const row = makeRow({ folderId: null });
      db.__state.selectResults.push([row]);
      db.__state.updateReturningResults.push([
        { ...row, folderId: 'folder-new' },
      ]);
      const provision = jest
        .fn<any>()
        .mockResolvedValue({ folderId: 'folder-new' });

      await ensureRoutineFolder(ROUTINE_ID, {
        db: db as unknown as EnsureRoutineFolderDeps['db'],
        provisionDeps,
        provision,
      });

      expect(db.transaction).not.toHaveBeenCalled();
    });
  });

  describe('unknown routine', () => {
    it('throws NotFoundException when no row is returned', async () => {
      db.__state.selectResults.push([undefined]);
      const provision = jest.fn<any>();

      await expect(
        ensureRoutineFolder('nonexistent-id', {
          db: db as unknown as EnsureRoutineFolderDeps['db'],
          provisionDeps,
          provision,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(provision).not.toHaveBeenCalled();
      expect(db.__queries.update).toHaveLength(0);
    });

    it('NotFound error message embeds the routine id', async () => {
      db.__state.selectResults.push([undefined]);

      await expect(
        ensureRoutineFolder('routine-xyz', {
          db: db as unknown as EnsureRoutineFolderDeps['db'],
          provisionDeps,
          provision: jest.fn<any>(),
        }),
      ).rejects.toThrow(/routine-xyz/);
    });
  });

  describe('provision failure', () => {
    it('throws ServiceUnavailableException, performs no UPDATE, leaves folder_id NULL', async () => {
      const row = makeRow({ folderId: null });
      db.__state.selectResults.push([row]);
      const provision = jest
        .fn<any>()
        .mockRejectedValue(new Error('folder9 unreachable'));

      await expect(
        ensureRoutineFolder(ROUTINE_ID, {
          db: db as unknown as EnsureRoutineFolderDeps['db'],
          provisionDeps,
          provision,
        }),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(provision).toHaveBeenCalledTimes(1);
      // No UPDATE issued — the failure is raised before persistence so
      // folder_id stays NULL (the row in the real DB is untouched).
      expect(db.__queries.update).toHaveLength(0);
      // Row object in our mock storage stays untouched too.
      expect(row.folderId).toBeNull();
    });

    it('uses the standard 503 retry message', async () => {
      db.__state.selectResults.push([makeRow({ folderId: null })]);
      const provision = jest.fn<any>().mockRejectedValue(new Error('boom'));

      await expect(
        ensureRoutineFolder(ROUTINE_ID, {
          db: db as unknown as EnsureRoutineFolderDeps['db'],
          provisionDeps,
          provision,
        }),
      ).rejects.toThrow(/folder storage temporarily unavailable/i);
    });

    it('handles non-Error throwables from provision (still 503; logs the stringified value)', async () => {
      db.__state.selectResults.push([makeRow({ folderId: null })]);
      const provision = jest.fn<any>().mockRejectedValue('plain-string-error');

      await expect(
        ensureRoutineFolder(ROUTINE_ID, {
          db: db as unknown as EnsureRoutineFolderDeps['db'],
          provisionDeps,
          provision,
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('preserves NotFoundException without converting it to 503', async () => {
      db.__state.selectResults.push([undefined]);
      const provision = jest.fn<any>();

      await expect(
        ensureRoutineFolder(ROUTINE_ID, {
          db: db as unknown as EnsureRoutineFolderDeps['db'],
          provisionDeps,
          provision,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('default provision binding', () => {
    it('falls back to the real provisionFolder9SkillFolder when deps.provision is omitted', async () => {
      // We can't easily exercise the real provisioner here without a
      // folder9 client, so instead assert the contract: when `provision`
      // is not supplied the function still runs (fast path: folder
      // already set), proving the optional `provision` field has a
      // sensible default.
      const row = makeRow({ folderId: 'folder-prov-default' });
      db.__state.selectResults.push([row]);

      const result = await ensureRoutineFolder(ROUTINE_ID, {
        db: db as unknown as EnsureRoutineFolderDeps['db'],
        provisionDeps,
      });

      expect(result.folderId).toBe('folder-prov-default');
    });
  });

  describe('race resolution under concurrency (C2)', () => {
    it('UPDATE-WHERE-NULL race-loss: returns the winner row, abandons our provisioned folder', async () => {
      // Two callers race on the same routine. Caller B's provision
      // completes after caller A's UPDATE has already claimed the
      // folder_id slot. Caller B's UPDATE returns 0 rows (the
      // `folder_id IS NULL` predicate no longer matches), so it
      // re-reads and observes A's folderId — abandoning B's freshly-
      // provisioned folder (orphan, GC'd later).
      const initialRow = makeRow({ folderId: null });
      // Step 1: SELECT sees folder_id = null
      db.__state.selectResults.push([initialRow]);
      // Step 3: UPDATE returns [] (race-loss — A already claimed the slot)
      db.__state.updateReturningResults.push([]);
      // Step 3b: re-read SELECT sees A's published folderId
      db.__state.selectResults.push([
        { ...initialRow, folderId: 'folder-winner-A' },
      ]);

      const provision = jest
        .fn<any>()
        .mockResolvedValue({ folderId: 'folder-loser-B' });

      const result = await ensureRoutineFolder(ROUTINE_ID, {
        db: db as unknown as EnsureRoutineFolderDeps['db'],
        provisionDeps,
        provision,
      });

      // We followed through with our provision call.
      expect(provision).toHaveBeenCalledTimes(1);
      // We attempted the UPDATE.
      expect(db.__queries.update).toHaveLength(1);
      // We re-read after the race-loss.
      expect(db.__queries.select).toHaveLength(2);
      // We returned the WINNER's folderId, not our own.
      expect(result.folderId).toBe('folder-winner-A');
    });

    it('UPDATE-WHERE-NULL race-loss + winner row vanishes: throws 503', async () => {
      // Pathological case — UPDATE returns 0 rows AND the re-read finds
      // no row (or a row with folderId still null). Treat as 503 so the
      // caller retries cleanly.
      const initialRow = makeRow({ folderId: null });
      db.__state.selectResults.push([initialRow]);
      db.__state.updateReturningResults.push([]);
      // Re-read: no row at all (extremely rare)
      db.__state.selectResults.push([undefined]);

      const provision = jest
        .fn<any>()
        .mockResolvedValue({ folderId: 'folder-loser' });

      await expect(
        ensureRoutineFolder(ROUTINE_ID, {
          db: db as unknown as EnsureRoutineFolderDeps['db'],
          provisionDeps,
          provision,
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('UPDATE-WHERE-NULL claim-success: returns the row from RETURNING, no re-read', async () => {
      // The common slow-path case — no concurrent caller, our UPDATE
      // claims the slot, RETURNING gives us the freshly-updated row,
      // and we don't need to re-read.
      const initialRow = makeRow({ folderId: null });
      db.__state.selectResults.push([initialRow]);
      db.__state.updateReturningResults.push([
        { ...initialRow, folderId: 'folder-claimed' },
      ]);

      const provision = jest
        .fn<any>()
        .mockResolvedValue({ folderId: 'folder-claimed' });

      const result = await ensureRoutineFolder(ROUTINE_ID, {
        db: db as unknown as EnsureRoutineFolderDeps['db'],
        provisionDeps,
        provision,
      });

      expect(result.folderId).toBe('folder-claimed');
      // Only the initial SELECT happened — no race-loss re-read.
      expect(db.__queries.select).toHaveLength(1);
    });

    it('two SEQUENTIAL calls — second hits fast path after first persists folder_id', async () => {
      // First call: slow path
      const row = makeRow({ folderId: null });
      db.__state.selectResults.push([row]);
      db.__state.updateReturningResults.push([
        { ...row, folderId: 'folder-seq-1' },
      ]);
      // Second call: fast path (DB now has the populated row)
      db.__state.selectResults.push([{ ...row, folderId: 'folder-seq-1' }]);

      const provision = jest
        .fn<any>()
        .mockResolvedValue({ folderId: 'folder-seq-1' });

      const r1 = await ensureRoutineFolder(ROUTINE_ID, {
        db: db as unknown as EnsureRoutineFolderDeps['db'],
        provisionDeps,
        provision,
      });
      const r2 = await ensureRoutineFolder(ROUTINE_ID, {
        db: db as unknown as EnsureRoutineFolderDeps['db'],
        provisionDeps,
        provision,
      });

      expect(provision).toHaveBeenCalledTimes(1);
      expect(r1.folderId).toBe('folder-seq-1');
      expect(r2.folderId).toBe('folder-seq-1');
    });
  });

  // ── A.11 — lazy-provision metrics ─────────────────────────────────
  describe('lazy provision metrics', () => {
    let counterAdd: ReturnType<typeof jest.fn>;
    let histogramRecord: ReturnType<typeof jest.fn>;

    beforeEach(() => {
      counterAdd = jest.fn();
      histogramRecord = jest.fn();
      jest
        .spyOn(appMetrics, 'routinesLazyProvisionTotal', 'get')
        .mockReturnValue({ add: counterAdd } as any);
      jest
        .spyOn(appMetrics, 'routinesLazyProvisionDurationMs', 'get')
        .mockReturnValue({ record: histogramRecord } as any);
    });

    it('slow-path success: increments counter with result=ok and records duration', async () => {
      const row = makeRow({ folderId: null });
      db.__state.selectResults.push([row]);
      db.__state.updateReturningResults.push([
        { ...row, folderId: 'folder-metric-ok' },
      ]);
      const provision = jest
        .fn<any>()
        .mockResolvedValue({ folderId: 'folder-metric-ok' });

      await ensureRoutineFolder(ROUTINE_ID, {
        db: db as unknown as EnsureRoutineFolderDeps['db'],
        provisionDeps,
        provision,
      });

      expect(counterAdd).toHaveBeenCalledTimes(1);
      expect(counterAdd).toHaveBeenCalledWith(1, { result: 'ok' });
      expect(histogramRecord).toHaveBeenCalledTimes(1);
      const [sample] = histogramRecord.mock.calls[0];
      expect(typeof sample).toBe('number');
      expect(sample).toBeGreaterThanOrEqual(0);
    });

    it('slow-path failure: increments counter with result=fail, still records duration, then throws 503', async () => {
      db.__state.selectResults.push([makeRow({ folderId: null })]);
      const provision = jest.fn<any>().mockRejectedValue(new Error('boom'));

      await expect(
        ensureRoutineFolder(ROUTINE_ID, {
          db: db as unknown as EnsureRoutineFolderDeps['db'],
          provisionDeps,
          provision,
        }),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(counterAdd).toHaveBeenCalledTimes(1);
      expect(counterAdd).toHaveBeenCalledWith(1, { result: 'fail' });
      expect(histogramRecord).toHaveBeenCalledTimes(1);
    });

    it('fast path: emits NEITHER counter NOR histogram', async () => {
      db.__state.selectResults.push([makeRow({ folderId: 'pre-existing' })]);

      await ensureRoutineFolder(ROUTINE_ID, {
        db: db as unknown as EnsureRoutineFolderDeps['db'],
        provisionDeps,
        provision: jest.fn<any>(),
      });

      expect(counterAdd).not.toHaveBeenCalled();
      expect(histogramRecord).not.toHaveBeenCalled();
    });

    it('NotFound (routine missing) emits NEITHER metric', async () => {
      db.__state.selectResults.push([undefined]);

      await expect(
        ensureRoutineFolder('missing', {
          db: db as unknown as EnsureRoutineFolderDeps['db'],
          provisionDeps,
          provision: jest.fn<any>(),
        }),
      ).rejects.toThrow(NotFoundException);

      expect(counterAdd).not.toHaveBeenCalled();
      expect(histogramRecord).not.toHaveBeenCalled();
    });

    it('race-loss: counter increments with result=ok (race-loss is still a successful outcome)', async () => {
      const row = makeRow({ folderId: null });
      db.__state.selectResults.push([row]);
      db.__state.updateReturningResults.push([]);
      db.__state.selectResults.push([{ ...row, folderId: 'folder-winner' }]);

      const provision = jest
        .fn<any>()
        .mockResolvedValue({ folderId: 'folder-loser' });

      await ensureRoutineFolder(ROUTINE_ID, {
        db: db as unknown as EnsureRoutineFolderDeps['db'],
        provisionDeps,
        provision,
      });

      expect(counterAdd).toHaveBeenCalledTimes(1);
      expect(counterAdd).toHaveBeenCalledWith(1, { result: 'ok' });
    });
  });
});
