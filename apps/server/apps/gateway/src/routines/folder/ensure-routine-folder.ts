/**
 * Lazy-provision invariant for `routines.folder_id`.
 *
 * Used by every public routine API entry point (GET / PATCH / start /
 * folder-proxy in A.5/A.6, plus the task-worker execution path in A.7) to
 * guarantee a non-null `folder_id` before responding.
 *
 * # Invariant
 *
 * After this function returns successfully, the routine row's `folder_id`
 * is non-null. Callers can therefore treat `routine.folderId` as
 * non-nullable in any code path downstream of `ensureRoutineFolder`.
 *
 * # Concurrency model — no row lock, optimistic claim
 *
 * The previous version held a `SELECT ... FOR UPDATE` row lock for the
 * full duration of the (3 sequential HTTP roundtrips, up to ~75s) folder9
 * provision. That pinned a Postgres connection for the worst-case latency
 * of folder9 — concurrent reads on the same routine queued behind it.
 *
 * The current shape avoids that hazard:
 *   1. Optimistic SELECT (no `.for('update')`, no transaction). If
 *      `folder_id` is already set, return the row as-is — the common case
 *      for any post-first-access routine.
 *   2. Provision OUTSIDE any tx — the slow folder9 calls run with no
 *      DB-side resources held.
 *   3. Race-resolved UPDATE: `UPDATE routines SET folder_id = $new
 *      WHERE id = $routineId AND folder_id IS NULL RETURNING *`. If
 *      another caller raced ahead and won, the WHERE returns 0 rows; we
 *      discard our newly-provisioned folder (orphan GC reclaims it after
 *      24h), re-read the routine, and return the winner's folderId.
 *      Otherwise we observe our claim and return the merged row.
 *
 * Two callers racing on the same routine never double-publish a folderId,
 * but they MAY both call folder9 — the loser's folder becomes an orphan
 * collected by the existing 24h GC sweep. The trade-off is intentional:
 * orphan folders are cheap, pinned DB connections aren't.
 *
 * # Failure modes
 *
 * - **Routine not found** → `NotFoundException` (404).
 * - **Provision throws** → caught and rewritten to
 *   `ServiceUnavailableException` (503). No DB write happens, so
 *   `folder_id` stays NULL and the next call self-heals.
 * - **UPDATE-WHERE-NULL returns 0 rows (race-loss)** → re-read and return
 *   the winner's row. The current caller's freshly-provisioned folder is
 *   abandoned (orphan).
 *
 * # Pure function, not a NestJS service
 *
 * Callers are NestJS services that pass dependencies via the `deps`
 * argument. Keeping this function plain (no `@Injectable`) means it is
 * trivially callable from anywhere — services, CLI batch scripts, or
 * the task-worker process — without DI plumbing.
 */

import {
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, isNull, type PostgresJsDatabase } from '@team9/database';
import * as schema from '@team9/database/schemas';
import { appMetrics } from '@team9/observability';

import {
  provisionFolder9SkillFolder,
  type ProvisionRoutineFolderDeps,
} from './provision-routine-folder.js';

const logger = new Logger('ensureRoutineFolder');

/**
 * Drizzle-inferred row type for `routine__routines`. Re-exporting locally
 * so callers can reference `RoutineRow` without dragging the full
 * `@team9/database/schemas` import surface.
 */
export type RoutineRow = typeof schema.routines.$inferSelect;

/**
 * Provision dependencies + DB handle.
 *
 * `provision` is optional: defaults to the real
 * {@link provisionFolder9SkillFolder}. Tests inject a spy via this slot
 * to avoid mocking the full folder9 client.
 */
export interface EnsureRoutineFolderDeps {
  db: PostgresJsDatabase<typeof schema>;
  provisionDeps: ProvisionRoutineFolderDeps;
  /**
   * Override for the provision function. Tests pass a jest spy here;
   * production callers omit it (defaults to {@link provisionFolder9SkillFolder}).
   */
  provision?: typeof provisionFolder9SkillFolder;
}

/**
 * Ensure the routine identified by `routineId` has a non-null `folder_id`,
 * provisioning it lazily if needed.
 *
 * @returns the routine row with `folderId` guaranteed non-null.
 * @throws {NotFoundException} if no routine row exists for `routineId`.
 * @throws {ServiceUnavailableException} if folder9 provisioning fails.
 *   No DB write happens, so `folder_id` stays NULL and the call
 *   self-heals on retry.
 */
export async function ensureRoutineFolder(
  routineId: string,
  deps: EnsureRoutineFolderDeps,
): Promise<RoutineRow> {
  const provisionFn = deps.provision ?? provisionFolder9SkillFolder;

  // ── Step 1: optimistic check — NO row lock, NO transaction ──
  //
  // The vast majority of calls hit this fast path (any routine that has
  // been touched at least once already has a folderId). Reading without
  // FOR UPDATE means no PG connection is pinned across folder9 latency.
  const [row] = (await deps.db
    .select()
    .from(schema.routines)
    .where(eq(schema.routines.id, routineId))
    .limit(1)) as RoutineRow[];

  if (!row) {
    throw new NotFoundException(`routine ${routineId} not found`);
  }

  // Fast path — already provisioned. Return the row as-is.
  if (row.folderId) {
    return row;
  }

  // ── Step 2: provision OUTSIDE any tx ──
  //
  // Up to 3 sequential HTTP roundtrips; folder9 client timeouts are 15s
  // (metadata) + 60s (commit). Holding a tx across this would pin a PG
  // connection for ~75s worst case and serialize concurrent reads on the
  // same routine — exactly the hazard this refactor is fixing.
  const slowPathStartedAt = Date.now();
  let provisioned: { folderId: string };
  try {
    provisioned = await provisionFn(
      {
        id: row.id,
        title: row.title,
        description: row.description,
        // The provision helper accepts a `RoutineLike` shape with
        // `documentContent` (a virtual field used by legacy migration
        // flows). The routines table no longer carries that column, so
        // we pass `null` — the helper falls back to its initial-scaffold
        // commit message and an empty SKILL.md body.
        documentContent: null,
      },
      deps.provisionDeps,
    );
  } catch (err) {
    // Record duration + fail counter BEFORE we throw — the OTEL
    // pipeline already has the sample by the time the 503 escapes.
    appMetrics.routinesLazyProvisionDurationMs.record(
      Date.now() - slowPathStartedAt,
    );
    appMetrics.routinesLazyProvisionTotal.add(1, { result: 'fail' });
    logger.warn(
      `provision failed for routine ${routineId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    throw new ServiceUnavailableException(
      'folder storage temporarily unavailable, please retry',
    );
  }

  // ── Step 3: race-resolved UPDATE ──
  //
  // `WHERE folder_id IS NULL` makes this a CAS-style claim. If another
  // caller already published a folder9 folder for this routine, our
  // WHERE matches zero rows; we then re-read and return the winner. The
  // folder we just minted becomes an orphan reclaimed by the existing
  // 24h GC sweep (see design §11).
  const updateResult = (await deps.db
    .update(schema.routines)
    .set({ folderId: provisioned.folderId, updatedAt: new Date() })
    .where(
      and(eq(schema.routines.id, routineId), isNull(schema.routines.folderId)),
    )
    .returning()) as RoutineRow[];

  if (updateResult.length === 0) {
    // Race-loss — another caller claimed the folderId slot first. Our
    // provisioned folder is now orphaned (will be reaped by GC). Re-read
    // and return the winner so the caller still gets a row with a
    // non-null folderId.
    logger.warn(
      `provision race-loss for routine ${routineId}; abandoning provisioned folder ${provisioned.folderId} (orphan GC will reclaim)`,
    );

    const [winner] = (await deps.db
      .select()
      .from(schema.routines)
      .where(eq(schema.routines.id, routineId))
      .limit(1)) as RoutineRow[];

    if (!winner || !winner.folderId) {
      // Defensive: extremely rare path — the row vanished or stayed NULL
      // between our UPDATE attempt and the re-read. Treat as a 503 to
      // get a clean retry.
      appMetrics.routinesLazyProvisionDurationMs.record(
        Date.now() - slowPathStartedAt,
      );
      appMetrics.routinesLazyProvisionTotal.add(1, { result: 'fail' });
      throw new ServiceUnavailableException(
        'folder storage temporarily unavailable, please retry',
      );
    }

    appMetrics.routinesLazyProvisionDurationMs.record(
      Date.now() - slowPathStartedAt,
    );
    // Race-loss is still a "successful" provision-attempt outcome from
    // the dashboard's perspective — the caller observes a populated
    // folder_id. The `result` label stays `ok` to keep the failure rate
    // alert untouched by ordinary contention.
    appMetrics.routinesLazyProvisionTotal.add(1, { result: 'ok' });
    return winner;
  }

  appMetrics.routinesLazyProvisionDurationMs.record(
    Date.now() - slowPathStartedAt,
  );
  appMetrics.routinesLazyProvisionTotal.add(1, { result: 'ok' });

  // Drizzle's UPDATE ... RETURNING returned exactly the row we just
  // claimed. Trust its folderId rather than splatting from the stale
  // SELECT result.
  return updateResult[0];
}
