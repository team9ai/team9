/**
 * Phase A.10 — Orphan folder9 GC script.
 *
 * Sweeps folder9 folders whose `name` starts with `routine-` but which are
 * NOT referenced by any `routines.folder_id` AND were created more than 24h
 * ago. Deletes each surviving candidate via {@link Folder9ClientService}.
 *
 * # When to run
 *
 * - On a low-frequency cron (e.g. nightly or every 6h) as a safety net.
 * - Manually after a rollout incident where a routine creation transaction
 *   committed the folder9 folder but failed before persisting the `folder_id`
 *   onto the `routines` row.
 *
 * The 24h grace window is the load-bearing safety constant: it covers the
 * Layer 1 batch migration's runtime, normal in-flight create-routine
 * transactions, and operator turnaround on incident response — never delete
 * a folder that *might* still be in the process of being claimed.
 *
 * # Algorithm
 *
 *   1. SELECT DISTINCT tenant_id FROM routines  → set of workspace ids.
 *      (This deployment uses `workspaceId === tenantId`; see the migration
 *      script at `migrate-routines-to-folder9.ts` for the same convention.)
 *   2. SELECT folder_id FROM routines WHERE folder_id IS NOT NULL
 *      → referenced set (used to filter out folders still owned by a
 *      routine row).
 *   3. For each tenant:
 *        a. folder9Client.listFolders(tenantId)
 *        b. filter to `name` starting with `routine-`
 *        c. for each candidate: if NOT referenced AND created_at < now-24h:
 *           - dry-run: log what would be deleted, increment skipped.
 *           - real:   folder9Client.deleteFolder(tenantId, folder.id),
 *                     increment deleted.
 *        d. count `recent` (under 24h, NOT referenced) and `referenced`
 *           (matched the referenced set) for the final stats line.
 *
 * Per-folder try/catch: a deleteFolder failure logs a warning and increments
 * `failed` but does NOT abort the sweep. Per-tenant try/catch on listFolders
 * has the same shape — one bad workspace must not poison the whole run.
 *
 * # --dry-run
 *
 * Performs every read (DB SELECTs + folder9 listFolders) and the same
 * filtering, but skips the deleteFolder call. Use this before scheduling
 * the cron the first time, after a folder9 schema change, or to size a
 * cleanup run after a known incident.
 *
 * # Tests
 *
 * Unit tests in `__tests__/cleanup-orphan-folder9-routines.spec.ts` exercise
 * the {@link cleanupOrphanFolder9Routines} export with a mocked db + folder9
 * client. They never hit a real database or folder9 instance.
 */

import { Logger } from '@nestjs/common';
import { isNotNull, type PostgresJsDatabase } from '@team9/database';
import * as schema from '@team9/database/schemas';

import type { Folder9ClientService } from '../src/wikis/folder9-client.service.js';
import type { Folder9Folder } from '../src/wikis/types/folder9.types.js';

// ── Types ─────────────────────────────────────────────────────────────

/**
 * Subset of {@link Folder9ClientService} this script relies on. Pinned as
 * `Pick<>` so any signature change in the real client surfaces here at
 * compile time. The script also runs `listFolders`, which was added in
 * A.10 — see folder9-client.service.ts.
 */
export type CleanupFolder9Client = Pick<
  Folder9ClientService,
  'listFolders' | 'deleteFolder'
>;

export interface CleanupStats {
  /** Folders successfully deleted (or counted as would-delete in dry-run). */
  deleted: number;
  /** Folders that matched the referenced set — kept because in use. */
  referenced: number;
  /** Folders newer than the 24h grace window — kept regardless of reference. */
  recent: number;
  /** Folders that failed deleteFolder; collected for the operator log. */
  failed: number;
  /** Folder ids that failed deleteFolder, in encounter order. */
  failedIds: string[];
  /** Workspaces that failed listFolders. The whole tenant is then skipped. */
  failedTenants: string[];
}

export interface CleanupDeps {
  db: PostgresJsDatabase<typeof schema>;
  folder9Client: CleanupFolder9Client;
  /** When true, perform reads only — skip deleteFolder. */
  dryRun: boolean;
  /** Logger override for tests; defaults to NestJS Logger. */
  logger?: Pick<Logger, 'log' | 'warn' | 'error'>;
  /**
   * Override "now" for deterministic tests. Defaults to `new Date()`. The
   * threshold is computed once at the start of the run so a long-running
   * sweep doesn't shift the cutoff on every folder.
   */
  now?: () => Date;
  /**
   * Grace window in milliseconds. Defaults to 24h — folders younger than
   * this are NEVER deleted. Tests override to exercise the threshold edge
   * (23h vs 25h).
   */
  graceMs?: number;
}

const DEFAULT_GRACE_MS = 24 * 60 * 60 * 1000;
const ROUTINE_FOLDER_PREFIX = 'routine-';

// ── Core sweep ───────────────────────────────────────────────────────

/**
 * Run the orphan folder9 GC sweep.
 *
 * @returns final stats. Caller surfaces them; tests assert on them directly.
 */
export async function cleanupOrphanFolder9Routines(
  deps: CleanupDeps,
): Promise<CleanupStats> {
  const logger = deps.logger ?? new Logger('CleanupOrphanFolder9Routines');
  const now = (deps.now ?? (() => new Date()))();
  const graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;
  const cutoff = new Date(now.getTime() - graceMs);

  const stats: CleanupStats = {
    deleted: 0,
    referenced: 0,
    recent: 0,
    failed: 0,
    failedIds: [],
    failedTenants: [],
  };

  // 1. Referenced set — folder ids still claimed by a routines row.
  const referencedRows = await deps.db
    .select({ folderId: schema.routines.folderId })
    .from(schema.routines)
    .where(isNotNull(schema.routines.folderId));
  const referenced = new Set<string>();
  for (const row of referencedRows) {
    if (row.folderId) referenced.add(row.folderId);
  }

  // 2. Distinct tenant ids — used as folder9 workspaceIds. We sweep every
  //    tenant that has ever owned a routine row; tenants with zero routines
  //    by definition never created a `routine-*` folder via this server, so
  //    they're outside the GC blast radius.
  const tenantRows = await deps.db
    .selectDistinct({ tenantId: schema.routines.tenantId })
    .from(schema.routines);
  const tenants = tenantRows.map((r) => r.tenantId);

  logger.log(
    `[cleanup-orphan-folder9-routines] starting (dryRun=${deps.dryRun}, ` +
      `tenants=${tenants.length}, referenced=${referenced.size}, ` +
      `cutoff=${cutoff.toISOString()})`,
  );

  // 3. Per-tenant sweep.
  for (const tenantId of tenants) {
    let folders: Folder9Folder[];
    try {
      folders = await deps.folder9Client.listFolders(tenantId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`listFolders for tenant ${tenantId} failed: ${msg}`);
      stats.failedTenants.push(tenantId);
      continue;
    }

    for (const folder of folders) {
      if (!folder.name.startsWith(ROUTINE_FOLDER_PREFIX)) continue;

      if (referenced.has(folder.id)) {
        stats.referenced += 1;
        continue;
      }

      // folder9 marshals `created_at` as RFC3339 / ISO 8601. Date.parse
      // returns NaN on a malformed value; we treat that as "unknown age"
      // and conservatively SKIP (not delete) the folder so we never blow
      // away anything we can't time-bound. Logged at warn level for ops.
      const createdAtMs = Date.parse(folder.created_at);
      if (Number.isNaN(createdAtMs)) {
        logger.warn(
          `folder ${folder.id} (name=${folder.name}, tenant=${tenantId}) ` +
            `has unparseable created_at=${folder.created_at}; skipping`,
        );
        continue;
      }

      if (createdAtMs >= cutoff.getTime()) {
        stats.recent += 1;
        continue;
      }

      const ageMs = now.getTime() - createdAtMs;
      const ageHours = (ageMs / 3_600_000).toFixed(1);

      if (deps.dryRun) {
        logger.log(
          `[dry-run] would delete folder ${folder.id} (name=${folder.name}, ` +
            `tenant=${tenantId}, age=${ageHours}h)`,
        );
        stats.deleted += 1;
        continue;
      }

      try {
        await deps.folder9Client.deleteFolder(tenantId, folder.id);
        stats.deleted += 1;
        logger.log(
          `deleted folder ${folder.id} (name=${folder.name}, ` +
            `tenant=${tenantId}, age=${ageHours}h)`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          `deleteFolder for ${folder.id} (tenant=${tenantId}) failed: ${msg}`,
        );
        stats.failed += 1;
        stats.failedIds.push(folder.id);
      }
    }
  }

  // 4. Final summary line. Format matches the acceptance-criteria spec
  //    string so an operator can grep for it in logs.
  const tenseDeleted = deps.dryRun ? 'would-delete' : 'deleted';
  logger.log(
    `cleanup done: ${tenseDeleted}=${stats.deleted} ` +
      `skipped=${stats.referenced} (referenced) ` +
      `recent=${stats.recent} (under 24h) ` +
      `failed=${stats.failed}`,
  );
  if (stats.failedIds.length > 0) {
    logger.warn(`failed folder ids: ${stats.failedIds.join(', ')}`);
  }
  if (stats.failedTenants.length > 0) {
    logger.warn(
      `failed tenants (listFolders): ${stats.failedTenants.join(', ')}`,
    );
  }

  return stats;
}

// ── CLI entry point ──────────────────────────────────────────────────

/**
 * Parse `--dry-run` from argv. Mirrors {@link parseArgs} in the migration
 * script. Exported so unit tests can pin the contract; the script's
 * `main()` passes `process.argv.slice(2)`.
 */
export function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes('--dry-run') };
}

/**
 * NestJS bootstrap entry point. Imported lazily inside main() so the test
 * file can import the pure {@link cleanupOrphanFolder9Routines} helper
 * without pulling AppModule (and its env-side-effect-laden imports) into
 * the test context.
 */
/* istanbul ignore next — exercised by the operator running the script,
   not by unit tests. The DB + folder9 wiring is integration-tested via
   the underlying client and folder spec suites. */
async function main(): Promise<void> {
  const logger = new Logger('CleanupOrphanFolder9Routines');
  const { dryRun } = parseArgs(process.argv.slice(2));
  logger.log(`Starting orphan folder9 GC sweep (dryRun=${dryRun})`);

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../src/app.module.js');
  const { DATABASE_CONNECTION } = await import('@team9/database');
  const { Folder9ClientService } =
    await import('../src/wikis/folder9-client.service.js');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const db = app.get(DATABASE_CONNECTION);
    const folder9Client = app.get(Folder9ClientService);

    const stats = await cleanupOrphanFolder9Routines({
      db,
      folder9Client,
      dryRun,
      logger,
    });

    if (stats.failed > 0 || stats.failedTenants.length > 0) {
      // Non-zero exit so cron / operator scripts can detect partial failure.
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

// Only run main() when invoked as a script — never when imported by tests.
// Tests import the module by path, so process.argv[1] points at the jest
// runner — basename does not match and main() does not fire.
/* istanbul ignore next — see main()'s istanbul ignore. */
const SCRIPT_BASENAME = 'cleanup-orphan-folder9-routines';
/* istanbul ignore next — script-mode entry guard, exercised manually. */
if (
  process.argv[1] &&
  process.argv[1].includes(SCRIPT_BASENAME) &&
  !process.env.CLEANUP_ORPHAN_FOLDER9_ROUTINES_SKIP_AUTORUN
) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
