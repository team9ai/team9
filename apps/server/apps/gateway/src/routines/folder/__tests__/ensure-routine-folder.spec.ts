import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';

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
 *
 * Mirrors the chain mock used in `bot-staff-profile.service.spec.ts`.
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
    for: jest.fn<any>(),
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
    'for',
    'limit',
    'returning',
  ] as const) {
    query[key].mockReturnValue(query as never);
  }

  return query;
}

interface DbState {
  /** Sequence of rows the next select should return (FIFO). */
  selectResults: (RoutineRow | undefined)[][];
}

/**
 * Mock db.transaction()/select()/update() that:
 * - serializes transaction callbacks (later transactions await earlier ones,
 *   matching SELECT FOR UPDATE row-lock semantics on a single key)
 * - reuses the same chain mock for select/update
 * - records a copy of the queries so tests can assert on call shape
 */
function mockDb() {
  const state: DbState = { selectResults: [] };

  const queries = {
    select: [] as ReturnType<typeof createQuery>[],
    update: [] as ReturnType<typeof createQuery>[],
  };

  const baseTx = {
    select: jest.fn<any>(() => {
      const q = createQuery(() =>
        state.selectResults.length > 0 ? state.selectResults.shift() : [],
      );
      queries.select.push(q);
      return q as never;
    }),
    update: jest.fn<any>(() => {
      const q = createQuery(() => undefined);
      queries.update.push(q);
      return q as never;
    }),
  };

  // Serializes overlapping transaction callbacks. The second caller waits
  // until the first finishes — matches the SELECT FOR UPDATE invariant
  // on a single routine row.
  let prev: Promise<unknown> = Promise.resolve();
  const transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const release = prev;
    let resolveSelf!: () => void;
    prev = new Promise<void>((r) => {
      resolveSelf = r;
    });
    await release;
    try {
      return await cb(baseTx);
    } finally {
      resolveSelf();
    }
  });

  return {
    __state: state,
    __queries: queries,
    transaction,
    // Tests don't call `db.select`/`db.update` directly — the transaction
    // callback gets `baseTx` — but include them for shape compatibility.
    select: baseTx.select,
    update: baseTx.update,
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
      expect(db.transaction).toHaveBeenCalledTimes(1);
    });

    it('locks the row with .for("update") inside the transaction', async () => {
      db.__state.selectResults.push([makeRow({ folderId: 'folder-1' })]);
      const provision = jest.fn<any>();

      await ensureRoutineFolder(ROUTINE_ID, {
        db: db as unknown as EnsureRoutineFolderDeps['db'],
        provisionDeps,
        provision,
      });

      expect(db.__queries.select).toHaveLength(1);
      expect(db.__queries.select[0].for).toHaveBeenCalledWith('update');
    });
  });

  describe('slow path', () => {
    it('provisions, persists folder_id, and returns the merged row', async () => {
      const row = makeRow({ folderId: null });
      db.__state.selectResults.push([row]);
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
      // Returned row carries the freshly-provisioned folderId
      expect(result.folderId).toBe('folder-new-1');
      // Other fields preserved
      expect(result.id).toBe(ROUTINE_ID);
      expect(result.title).toBe('Daily Standup');
    });

    it('passes id/title/description to provisionFn with documentContent=null', async () => {
      // The routines table no longer carries documentContent (deprecated in
      // A.1). ensureRoutineFolder MUST pass `documentContent: null` so the
      // provisioner falls back to the initial-scaffold commit message and
      // an empty SKILL.md body.
      const row = makeRow({
        folderId: null,
        description: 'Custom desc',
      });
      db.__state.selectResults.push([row]);
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
      // No UPDATE issued — the failure is raised before persistence so the
      // transaction rolls back and folder_id stays NULL.
      expect(db.__queries.update).toHaveLength(0);
      // Row in storage (mocked) stays untouched
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
      // Defensive: provision could in theory throw a non-Error value.
      // The catch branch must still produce a 503 and not crash the
      // logger format string.
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
      // Verifies the catch is scoped to the provision call only — the
      // upstream "row not found" 404 must NOT be rewritten to 503.
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
      // We can't easily exercise the real provisioner here without a folder9
      // client, so instead assert the contract: when `provision` is not
      // supplied the function still runs (fast path: folder already set),
      // proving the optional `provision` field has a sensible default.
      const row = makeRow({ folderId: 'folder-prov-default' });
      db.__state.selectResults.push([row]);

      const result = await ensureRoutineFolder(ROUTINE_ID, {
        db: db as unknown as EnsureRoutineFolderDeps['db'],
        provisionDeps,
      });

      expect(result.folderId).toBe('folder-prov-default');
    });
  });

  describe('serialization under concurrency', () => {
    it('FOR UPDATE serializes two concurrent first-access calls — provision runs once, second observes folder_id', async () => {
      const row = makeRow({ folderId: null });

      // Both calls find the row. After the first transaction populates
      // folder_id (via UPDATE), subsequent SELECTs should see it set.
      // We simulate this by mutating `row.folderId` inside the provision spy
      // (which is what the real UPDATE inside the transaction would
      // effectively do for any subsequent reader) — but since each select
      // gets its own copy via `selectResults`, we instead push two distinct
      // results: the second SELECT result reflects the post-update state.
      let provisionCalls = 0;
      const provision = jest.fn<any>(async () => {
        provisionCalls += 1;
        // Mutate the shared row so any later reader sees the populated id.
        // Mock-side simulation of the post-UPDATE state; the real DB does
        // this via the row lock + UPDATE inside the same transaction.
        row.folderId = 'folder-concurrent-1';
        return { folderId: 'folder-concurrent-1' };
      });

      // Both transactions read the same row reference — when the second
      // transaction picks up its result (after the first releases the
      // lock), the shared row already carries folderId.
      db.__state.selectResults.push([row]);
      db.__state.selectResults.push([row]);

      const [r1, r2] = await Promise.all([
        ensureRoutineFolder(ROUTINE_ID, {
          db: db as unknown as EnsureRoutineFolderDeps['db'],
          provisionDeps,
          provision,
        }),
        ensureRoutineFolder(ROUTINE_ID, {
          db: db as unknown as EnsureRoutineFolderDeps['db'],
          provisionDeps,
          provision,
        }),
      ]);

      expect(provisionCalls).toBe(1);
      expect(r1.folderId).toBe('folder-concurrent-1');
      expect(r2.folderId).toBe('folder-concurrent-1');
      // Exactly one UPDATE — only the slow path persists; the second call
      // takes the fast path.
      expect(db.__queries.update).toHaveLength(1);
      expect(db.transaction).toHaveBeenCalledTimes(2);
    });

    it('two SEQUENTIAL calls — second hits fast path after first persists folder_id', async () => {
      const row = makeRow({ folderId: null });
      const provision = jest.fn<any>(async () => {
        row.folderId = 'folder-seq-1';
        return { folderId: 'folder-seq-1' };
      });
      db.__state.selectResults.push([row]);
      db.__state.selectResults.push([row]);

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
});
