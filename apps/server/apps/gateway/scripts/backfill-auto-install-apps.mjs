#!/usr/bin/env node
/**
 * Backfill auto-install applications (base-model-staff, common-staff) for all
 * existing tenants that don't have them yet.
 *
 * This replaced the old onModuleInit auto-backfill that blocked server startup
 * and exceeded Railway's healthcheck timeout. Run this manually after deploying
 * new auto-install apps.
 *
 * Bootstraps a NestJS standalone app to get full handler execution (bot
 * creation, DM channels, claw-hive registration, etc.).
 *
 * Prerequisites: pnpm build:server
 *
 * Prerequisites: pnpm build:server
 *
 * Usage (from repo root):
 *   # Against dev Railway:
 *   pnpm dotenv -e .env.dev.local -e .env -- pnpm run backfill:apps
 *
 *   # Against production:
 *   pnpm dotenv -e .env.prod.local -e .env -- pnpm run backfill:apps
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../dist/app.module.js';
import { InstalledApplicationsService } from '../dist/applications/installed-applications.service.js';

async function main() {
  const logger = new Logger('BackfillScript');
  logger.log('Starting auto-install backfill...');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const service = app.get(InstalledApplicationsService);
  await service.backfillAutoInstallApps();

  logger.log('Backfill complete.');
  await app.close();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
