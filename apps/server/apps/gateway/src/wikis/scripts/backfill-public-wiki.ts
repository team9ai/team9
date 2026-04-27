/**
 * Backfill Public Wiki Script
 *
 * Seeds a default `public` Wiki for every existing workspace that doesn't
 * already have one. Runs the same code path as the workspace creation seed
 * hook (WikisService.createWiki) so the invariant that `workspace_wikis` is
 * the authoritative allow-list is preserved.
 *
 * Idempotent: each workspace is checked against `workspace_wikis` before we
 * attempt to seed. Running twice is a no-op on the second pass.
 *
 * Usage (from the monorepo root):
 *   pnpm --filter @team9/gateway exec tsx \
 *     apps/server/apps/gateway/src/wikis/scripts/backfill-public-wiki.ts
 *
 * Or with ts-node / swc-node:
 *   node --loader @swc-node/register/esm \
 *     apps/server/apps/gateway/src/wikis/scripts/backfill-public-wiki.ts
 *
 * Environment:
 *   Requires the same .env as the gateway service (DATABASE_URL,
 *   FOLDER9_API_URL, FOLDER9_GIT_URL, PSK, ...).
 *
 * Exit codes:
 *   0 — completed (some workspaces may have errored individually, but the
 *       script ran to completion and printed a summary)
 *   1 — unrecoverable error (couldn't boot the NestJS context, couldn't
 *       list tenants, etc.)
 */
import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { WikisService } from '../wikis.service.js';
import {
  DATABASE_CONNECTION,
  and,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';

export interface BackfillStats {
  total: number;
  created: number;
  skipped: number;
  errored: number;
}

export type AppContextFactory = () => Promise<INestApplicationContext>;

/**
 * Core backfill loop — exported so it can be unit-tested with a fake NestJS
 * context. Real CLI entry point below wires this to `NestFactory`.
 */
export async function runBackfill(
  createAppContext: AppContextFactory,
  logger: Logger = new Logger('BackfillPublicWiki'),
): Promise<BackfillStats> {
  const app = await createAppContext();
  const wikisService = app.get(WikisService);
  const db = app.get<PostgresJsDatabase<typeof schema>>(DATABASE_CONNECTION);

  const stats: BackfillStats = {
    total: 0,
    created: 0,
    skipped: 0,
    errored: 0,
  };

  try {
    const workspaces = await db
      .select({ id: schema.tenants.id, name: schema.tenants.name })
      .from(schema.tenants);

    stats.total = workspaces.length;
    logger.log(`Scanning ${workspaces.length} workspace(s) for public wiki`);

    for (const ws of workspaces) {
      try {
        const existing = await db
          .select({ id: schema.workspaceWikis.id })
          .from(schema.workspaceWikis)
          .where(
            and(
              eq(schema.workspaceWikis.workspaceId, ws.id),
              eq(schema.workspaceWikis.slug, 'public'),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          stats.skipped++;
          logger.debug(
            `workspace ${ws.id} (${ws.name}) already has a public wiki — skipping`,
          );
          continue;
        }

        const owner = await db
          .select({ userId: schema.tenantMembers.userId })
          .from(schema.tenantMembers)
          .where(
            and(
              eq(schema.tenantMembers.tenantId, ws.id),
              eq(schema.tenantMembers.role, 'owner'),
            ),
          )
          .limit(1);

        if (owner.length === 0) {
          stats.skipped++;
          logger.warn(
            `workspace ${ws.id} (${ws.name}) has no owner — skipping`,
          );
          continue;
        }

        await wikisService.createWiki(
          ws.id,
          { id: owner[0].userId, isAgent: false },
          { name: 'public', slug: 'public' },
        );
        stats.created++;
        logger.log(`seeded public wiki for workspace ${ws.id} (${ws.name})`);
      } catch (err) {
        stats.errored++;
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          `failed to seed public wiki for workspace ${ws.id}: ${msg}`,
        );
      }
    }

    logger.log(
      `backfill complete: created=${stats.created}, skipped=${stats.skipped}, errored=${stats.errored}`,
    );
  } finally {
    await app.close();
  }

  return stats;
}

/* istanbul ignore next -- CLI boot path; the exported runBackfill is the
   unit-tested surface. Heavy imports (load-env, AppModule, NestFactory) are
   pulled in lazily so that unit tests can import `runBackfill` without
   bootstrapping the entire gateway (which requires JWT_PRIVATE_KEY et al. at
   module-load time). */
async function main(): Promise<void> {
  await import('../../load-env.js');
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../../app.module.js');

  const stats = await runBackfill(() =>
    NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn', 'log'],
    }),
  );
  // Exit 0 unless the script itself could not run. Per-workspace failures
  // are logged and reported in `stats.errored` but do not fail the script —
  // re-running is safe (idempotent).

  console.log(
    `backfill summary: total=${stats.total}, created=${stats.created}, skipped=${stats.skipped}, errored=${stats.errored}`,
  );
}

// Only run when invoked directly (not when imported in tests).
/* istanbul ignore next -- invoked-as-script guard; unit tests import the
   module instead of running it. */
if (
  import.meta.url ===
  `file://${typeof process !== 'undefined' ? process.argv[1] : ''}`
) {
  main().catch((err: unknown) => {
    console.error('backfill failed:', err);
    process.exit(1);
  });
}
