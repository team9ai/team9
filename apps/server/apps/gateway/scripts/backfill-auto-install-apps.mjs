#!/usr/bin/env node
/**
 * Backfill auto-install applications for all existing tenants.
 *
 * Prerequisites: pnpm build:server
 *
 * Usage (from repo root):
 *   pnpm dotenv -e .env.dev.local -e .env -- pnpm run backfill:apps
 *   pnpm dotenv -e .env.prod.local -e .env -- pnpm run backfill:apps
 *
 * Env options:
 *   CONCURRENCY=5    - Parallel installs (default: 5)
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../dist/app.module.js';
import { InstalledApplicationsService } from '../dist/applications/installed-applications.service.js';
import { ApplicationsService } from '../dist/applications/applications.service.js';
import { DATABASE_CONNECTION, eq, sql } from '@team9/database';
import * as schema from '@team9/database/schemas';

const CONCURRENCY = parseInt(process.env.CONCURRENCY || '5', 10);

async function main() {
  const logger = new Logger('BackfillScript');
  logger.log(`Starting backfill (concurrency=${CONCURRENCY})...`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const installedAppsService = app.get(InstalledApplicationsService);
  const applicationsService = app.get(ApplicationsService);
  const db = app.get(DATABASE_CONNECTION);

  const autoInstallApps = applicationsService.findAutoInstall();
  if (autoInstallApps.length === 0) {
    logger.log('No auto-install apps. Done.');
    await app.close();
    return;
  }
  const appIds = autoInstallApps.map((a) => a.id);
  logger.log(`Apps: ${appIds.join(', ')}`);

  // 1. Get all tenants + what they already have installed — single query
  const allInstalled = await db
    .select({
      tenantId: schema.installedApplications.tenantId,
      applicationId: schema.installedApplications.applicationId,
    })
    .from(schema.installedApplications);

  // Group by tenant
  const tenantApps = new Map();
  for (const row of allInstalled) {
    if (!row.tenantId) continue;
    if (!tenantApps.has(row.tenantId)) tenantApps.set(row.tenantId, new Set());
    tenantApps.get(row.tenantId).add(row.applicationId);
  }
  logger.log(`Found ${tenantApps.size} tenant(s)`);

  // 2. Build work items
  const work = [];
  for (const [tenantId, installedIds] of tenantApps) {
    for (const appDef of autoInstallApps) {
      if (!installedIds.has(appDef.id)) {
        work.push({ tenantId, appId: appDef.id, appName: appDef.name });
      }
    }
  }
  logger.log(`${work.length} install(s) needed`);

  if (work.length === 0) {
    logger.log('Nothing to backfill.');
    await app.close();
    return;
  }

  // 3. Batch-fetch one installer per tenant (only for tenants that need work)
  const tenantsNeedingWork = [...new Set(work.map((w) => w.tenantId))];
  const installerMap = new Map();
  // Query in batches of 100 to avoid huge IN clauses
  for (let i = 0; i < tenantsNeedingWork.length; i += 100) {
    const batch = tenantsNeedingWork.slice(i, i + 100);
    const rows = await db.execute(sql`
      SELECT DISTINCT ON (tenant_id) tenant_id, user_id
      FROM tenant_members
      WHERE tenant_id IN (${sql.join(batch.map(id => sql`${id}`), sql`, `)})
    `);
    for (const row of rows.rows || rows) {
      installerMap.set(row.tenant_id, row.user_id);
    }
  }
  logger.log(`Found installers for ${installerMap.size}/${tenantsNeedingWork.length} tenant(s)`);

  // 4. Process with concurrency pool
  let done = 0;
  let errors = 0;
  let skipped = 0;
  let idx = 0;

  async function processItem(item) {
    const installerId = installerMap.get(item.tenantId);
    if (!installerId) {
      skipped++;
      return;
    }
    try {
      await installedAppsService.install(item.tenantId, installerId, {
        applicationId: item.appId,
      });
      done++;
      logger.log(`[${done + errors}/${work.length}] ✅ ${item.appName} → ${item.tenantId}`);
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[${done + errors}/${work.length}] ❌ ${item.appName} → ${item.tenantId}: ${msg}`);
    }
  }

  async function worker() {
    while (idx < work.length) {
      const item = work[idx++];
      await processItem(item);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, work.length) }, () => worker()),
  );

  logger.log('');
  logger.log(`── Done ── Installed: ${done}, Errors: ${errors}, Skipped: ${skipped}, Total: ${work.length}`);
  await app.close();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
