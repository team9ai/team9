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
 * # Concurrency model
 *
 * Two callers racing on the same routine MUST not double-provision (would
 * leak an orphan folder9 folder). The function opens a DB transaction and
 * issues `SELECT ... FOR UPDATE` on the routine row, which serializes the
 * critical section: the second caller blocks on the row lock until the
 * first commits, then re-reads and sees `folder_id` already populated —
 * fast path returns the row, no second provision call.
 *
 * # Failure modes
 *
 * - **Routine not found** → `NotFoundException` (404). The transaction
 *   rolls back; nothing is persisted.
 * - **Provision throws** (folder9 down / token mint failed / commit
 *   failed) → caught and rewritten to `ServiceUnavailableException`
 *   (503). The transaction rolls back, so `folder_id` stays NULL and the
 *   next call will retry — self-healing.
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
import { eq, type PostgresJsDatabase } from '@team9/database';
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
 *   The DB transaction rolls back so `folder_id` stays NULL and the call
 *   self-heals on retry.
 */
export async function ensureRoutineFolder(
  routineId: string,
  deps: EnsureRoutineFolderDeps,
): Promise<RoutineRow> {
  const provisionFn = deps.provision ?? provisionFolder9SkillFolder;

  return await deps.db.transaction(async (tx) => {
    // SELECT ... FOR UPDATE — locks the row for the duration of this
    // transaction. A racing transaction on the same routineId blocks
    // until we commit, then re-reads with the row lock and observes
    // the populated folder_id (fast path).
    const [row] = (await tx
      .select()
      .from(schema.routines)
      .where(eq(schema.routines.id, routineId))
      .for('update')) as RoutineRow[];

    if (!row) {
      throw new NotFoundException(`routine ${routineId} not found`);
    }

    // Fast path — already provisioned. Return the row as-is; no provision
    // call, no UPDATE.
    if (row.folderId) {
      return row;
    }

    // Slow path — first access since the routine was created (or a
    // legacy row that pre-dates the folder column). Provision a folder9
    // managed folder and persist its id.
    //
    // Metrics: time the provision call itself (the dominant cost), AND
    // emit a `lazy_provision_total{result}` counter increment AFTER the
    // success/failure resolves. The duration histogram covers BOTH
    // branches so dashboards can see fail-mode latency tails (folder9
    // timeouts are often the worst-case slow samples).
    const slowPathStartedAt = Date.now();
    let provisioned: { folderId: string };
    try {
      // The provision helper accepts a `RoutineLike` shape with
      // `documentContent` (a virtual field used by legacy migration
      // flows). The routines table no longer carries that column, so we
      // pass `null` — the helper falls back to its initial-scaffold
      // commit message and an empty SKILL.md body.
      provisioned = await provisionFn(
        {
          id: row.id,
          title: row.title,
          description: row.description,
          documentContent: null,
        },
        deps.provisionDeps,
      );
    } catch (err) {
      // Record duration + fail counter BEFORE we throw — a throw escapes
      // the transaction callback, Drizzle ROLLBACKs, and the metric
      // emit happens against the OTEL pipeline (no DB coupling).
      appMetrics.routinesLazyProvisionDurationMs.record(
        Date.now() - slowPathStartedAt,
      );
      appMetrics.routinesLazyProvisionTotal.add(1, { result: 'fail' });
      logger.warn(
        `provision failed for routine ${routineId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Re-throw as 503 so API callers get a retryable signal. The DB
      // transaction rolls back when this throws — folder_id stays NULL
      // and the next ensureRoutineFolder call retries cleanly.
      throw new ServiceUnavailableException(
        'folder storage temporarily unavailable, please retry',
      );
    }

    await tx
      .update(schema.routines)
      .set({ folderId: provisioned.folderId, updatedAt: new Date() })
      .where(eq(schema.routines.id, routineId));

    // Slow-path success — duration covers the provision + UPDATE pair, the
    // counter records `result=ok`. We intentionally measure here (after
    // the UPDATE) and not after `tx` commits — Drizzle commits the tx on
    // callback return, and the additional commit RTT is not part of
    // "lazy provision latency" as users see it.
    appMetrics.routinesLazyProvisionDurationMs.record(
      Date.now() - slowPathStartedAt,
    );
    appMetrics.routinesLazyProvisionTotal.add(1, { result: 'ok' });

    // Return the merged row — the SELECT result with the new folderId
    // splatted in. Avoids a second SELECT round-trip.
    return { ...row, folderId: provisioned.folderId };
  });
}
