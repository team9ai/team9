/**
 * Layer 1 batch migration — backfills `routines.folder_id` for legacy rows
 * that pre-date the folder9-managed-folder migration (Task 0 / Phase A).
 *
 * # Run window
 *
 * Run during the rollout window: AFTER the server deploy that ships
 * `provisionFolder9SkillFolder` and BEFORE the agent-pi deploy that starts
 * relying on `folder_id` non-null. Layer 2 lazy provision in
 * {@link ../src/routines/folder/ensure-routine-folder.js} stays on
 * permanently to catch stragglers.
 *
 * # Usage
 *
 * ```bash
 * pnpm dotenv -e .env.dev.local -e .env -- pnpm migrate:routines
 * pnpm dotenv -e .env.prod.local -e .env -- pnpm migrate:routines -- --dry-run
 * ```
 *
 * # Algorithm
 *
 * Cursor-paginated by `routines.id` ascending, page size 100. For each row
 * with `folder_id IS NULL`:
 *
 *   1. Resolve documentContent from the linked Document chain
 *      (routine.documentId → documents.currentVersionId →
 *      document_versions.content). Falls back to null if any link is
 *      missing — the provisioner then emits an "Initial scaffold" SKILL.md
 *      with an empty body.
 *   2. Call {@link provisionFolder9SkillFolder} with `workspaceId =
 *      routine.tenantId` (the workspace ID is the tenant ID in this
 *      deployment — see routines.service.ts).
 *   3. UPDATE `routines` SET folder_id = <new> WHERE id = <row.id>.
 *
 * Per-row try/catch — one failure does not abort the batch. Failed ids are
 * collected and logged at the end so an operator can re-run after fixing
 * the underlying cause; Layer 2 lazy provision will also pick them up the
 * next time someone touches the routine.
 *
 * # Idempotence
 *
 * The base query filters `folder_id IS NULL`, so re-running on the same DB
 * is safe — already-provisioned rows are silently skipped.
 *
 * # --dry-run
 *
 * Performs all SELECTs (cursor walk + document content resolution) and
 * logs what would be migrated, but skips the `provisionFolder9SkillFolder`
 * call AND the UPDATE. Useful for sizing the migration window before
 * running it for real.
 *
 * # Tests
 *
 * Unit tests in `__tests__/migrate-routines-to-folder9.spec.ts` exercise
 * the {@link migrateRoutinesToFolder9} export with mocked db / folder9
 * client. They never hit a real database or folder9 instance.
 */

import { Logger } from '@nestjs/common';
import { and, eq, gt, isNull, type PostgresJsDatabase } from '@team9/database';
import * as schema from '@team9/database/schemas';

import {
  provisionFolder9SkillFolder,
  type ProvisionRoutineFolder9Client,
  type RoutineLike,
} from '../src/routines/folder/provision-routine-folder.js';

// ── Types ─────────────────────────────────────────────────────────────

/**
 * Subset of a routine row the migration cares about. Avoids dragging the
 * full `typeof schema.routines.$inferSelect` shape so tests can build
 * fixtures with just these fields.
 */
export interface MigrationRoutineRow {
  id: string;
  tenantId: string;
  title: string;
  description: string | null;
  documentId: string | null;
  folderId: string | null;
}

export interface MigrationStats {
  ok: number;
  failed: number;
  skipped: number;
  failedIds: string[];
}

/**
 * Dependencies for {@link migrateRoutinesToFolder9}. Tests construct a
 * minimal mock; production calls {@link main} which builds the real DB
 * + Folder9ClientService via NestJS.
 */
export interface MigrationDeps {
  db: PostgresJsDatabase<typeof schema>;
  folder9Client: ProvisionRoutineFolder9Client;
  /**
   * Pre-shared key for folder9. Forwarded to the provisioner's deps for
   * forward-compat (current Folder9ClientService reads FOLDER9_PSK from
   * env — see provision-routine-folder.ts).
   */
  psk: string;
  /** When true, perform reads only — skip provision + UPDATE. */
  dryRun: boolean;
  /** Override for dependency injection in tests. */
  provision?: typeof provisionFolder9SkillFolder;
  /** Logger override for tests; defaults to NestJS Logger. */
  logger?: Pick<Logger, 'log' | 'warn' | 'error'>;
  /**
   * Page size for the cursor walk. Production uses 100 (per spec); tests
   * may override to exercise pagination boundaries with smaller fixtures.
   */
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 100;

// ── Core migration loop ──────────────────────────────────────────────

/**
 * Resolve the `documentContent` virtual field by walking
 * routine → documents → document_versions. Returns null on any missing
 * link (orphan documentId, deleted document, no currentVersion).
 *
 * Kept separate from the main loop so the resolver is independently
 * unit-testable and so a future schema change (e.g. moving content
 * storage to S3) only touches this function.
 */
async function resolveDocumentContent(
  db: PostgresJsDatabase<typeof schema>,
  documentId: string | null,
): Promise<string | null> {
  if (!documentId) return null;

  const [doc] = await db
    .select({ currentVersionId: schema.documents.currentVersionId })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId))
    .limit(1);

  if (!doc?.currentVersionId) return null;

  const [version] = await db
    .select({ content: schema.documentVersions.content })
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.id, doc.currentVersionId))
    .limit(1);

  return version?.content ?? null;
}

/**
 * Run the Layer 1 batch migration.
 *
 * @returns final stats. Caller is responsible for surfacing them to the
 * operator (the {@link main} entry point logs them; tests assert on them
 * directly).
 */
export async function migrateRoutinesToFolder9(
  deps: MigrationDeps,
): Promise<MigrationStats> {
  const logger = deps.logger ?? new Logger('MigrateRoutinesToFolder9');
  const provisionFn = deps.provision ?? provisionFolder9SkillFolder;
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const stats: MigrationStats = { ok: 0, failed: 0, skipped: 0, failedIds: [] };

  // UUID '0...0' is the lowest sortable value — first page starts strictly
  // greater than this sentinel. Subsequent pages advance the cursor to
  // the last id seen on the previous page, so the walk visits every
  // matching row exactly once even if rows are concurrently inserted
  // during the migration (new rows sort higher).
  let cursor = '00000000-0000-0000-0000-000000000000';

  while (true) {
    const batch = (await deps.db
      .select({
        id: schema.routines.id,
        tenantId: schema.routines.tenantId,
        title: schema.routines.title,
        description: schema.routines.description,
        documentId: schema.routines.documentId,
        folderId: schema.routines.folderId,
      })
      .from(schema.routines)
      .where(
        and(isNull(schema.routines.folderId), gt(schema.routines.id, cursor)),
      )
      .orderBy(schema.routines.id)
      .limit(pageSize)) as MigrationRoutineRow[];

    if (batch.length === 0) break;

    for (const row of batch) {
      try {
        const documentContent = await resolveDocumentContent(
          deps.db,
          row.documentId,
        );

        if (deps.dryRun) {
          logger.log(
            `[dry-run] would migrate routine ${row.id} (tenant=${row.tenantId}, contentLen=${documentContent?.length ?? 0})`,
          );
          stats.skipped += 1;
          continue;
        }

        const routineLike: RoutineLike = {
          id: row.id,
          title: row.title,
          description: row.description,
          documentContent,
        };

        const provisioned = await provisionFn(routineLike, {
          folder9Client: deps.folder9Client,
          workspaceId: row.tenantId,
          psk: deps.psk,
        });

        await deps.db
          .update(schema.routines)
          .set({ folderId: provisioned.folderId, updatedAt: new Date() })
          .where(eq(schema.routines.id, row.id));

        stats.ok += 1;
        logger.log(
          `migrated routine ${row.id} → folder ${provisioned.folderId}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`migrate routine ${row.id} failed: ${msg}`);
        stats.failed += 1;
        stats.failedIds.push(row.id);
      }
    }

    // Advance the cursor to the last id processed regardless of per-row
    // outcome. Failed rows must NOT block the cursor — they already
    // recorded a `failedIds` entry and Layer 2 will catch them on next
    // access. Re-running the script will skip ok-rows (folder_id is
    // non-null) and retry failed-rows (folder_id still null).
    cursor = batch[batch.length - 1].id;

    // Safety break: if the page came back smaller than the limit, no
    // more rows can match the predicate. Avoids one extra empty SELECT.
    if (batch.length < pageSize) break;
  }

  if (deps.dryRun) {
    logger.log(
      `migration done (dry-run): would migrate=${stats.skipped} (no failures recorded — provision was skipped)`,
    );
  } else {
    logger.log(`migration done: ok=${stats.ok} failed=${stats.failed}`);
    if (stats.failedIds.length > 0) {
      logger.warn(`failed ids: ${stats.failedIds.join(', ')}`);
    }
  }

  return stats;
}

// ── CLI entry point ──────────────────────────────────────────────────

/**
 * Parse `--dry-run` from argv. Only flag we accept; anything else is
 * ignored (forward-compat with `pnpm migrate:routines -- --dry-run`
 * passing extra pnpm-injected args).
 *
 * Exported so unit tests can pin the contract; the script's `main()`
 * passes `process.argv.slice(2)`.
 */
export function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes('--dry-run') };
}

/**
 * NestJS bootstrap entry point. Imported lazily inside main() so the
 * test file can import the pure {@link migrateRoutinesToFolder9} helper
 * without pulling AppModule (and its env-side-effect-laden imports) into
 * the test context.
 */
/* istanbul ignore next — exercised by the operator running the script,
   not by unit tests. The DB + folder9 wiring is integration-tested via
   the underlying provisioner spec and ensure-routine-folder spec. */
async function main(): Promise<void> {
  const logger = new Logger('MigrateRoutinesToFolder9');
  const { dryRun } = parseArgs(process.argv.slice(2));
  logger.log(`Starting Layer 1 routine→folder9 migration (dryRun=${dryRun})`);

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../src/app.module.js');
  const { DATABASE_CONNECTION } = await import('@team9/database');
  const { Folder9ClientService } =
    await import('../src/wikis/folder9-client.service.js');
  const { env } = await import('@team9/shared');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const db = app.get(DATABASE_CONNECTION);
    const folder9Client = app.get(Folder9ClientService);
    const psk = env.FOLDER9_PSK ?? '';

    const stats = await migrateRoutinesToFolder9({
      db,
      folder9Client,
      psk,
      dryRun,
      logger,
    });

    if (stats.failed > 0) {
      // Non-zero exit so CI / operator scripts can detect partial failure
      // even though the batch as a whole completed.
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

// Only run main() when invoked as a script — never when imported by tests.
// We compare the basename of process.argv[1] (the entry point the user
// invoked) against this file's filename. This avoids top-level await
// (which ts-jest under ESM doesn't always handle smoothly) and platform-
// specific URL/path conversions.
//
// Tests import the module by path, so process.argv[1] points at the jest
// runner — basename does not match and main() does not fire.
/* istanbul ignore next — see main()'s istanbul ignore. */
const SCRIPT_BASENAME = 'migrate-routines-to-folder9';
/* istanbul ignore next — script-mode entry guard, exercised manually. */
if (
  process.argv[1] &&
  process.argv[1].includes(SCRIPT_BASENAME) &&
  !process.env.MIGRATE_ROUTINES_SKIP_AUTORUN
) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
