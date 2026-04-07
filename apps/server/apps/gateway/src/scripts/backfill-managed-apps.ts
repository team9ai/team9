/**
 * Backfill Managed Apps Migration Script
 *
 * This script bootstraps the NestJS application context and:
 * 1. Scans all active tenants
 * 2. Installs missing managed apps (common-staff, personal-staff, base-model-staff)
 * 3. For newly installed personal-staff: creates a personal staff bot for each existing member
 *
 * Usage:
 *   npx ts-node --esm apps/server/apps/gateway/src/scripts/backfill-managed-apps.ts
 *
 * Environment:
 *   Requires the same .env as the gateway service.
 */
import '../load-env.js';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module.js';
import { InstalledApplicationsService } from '../applications/installed-applications.service.js';
import { ApplicationsService } from '../applications/applications.service.js';
import { PersonalStaffService } from '../applications/personal-staff.service.js';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  isNull,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';

const PERSONAL_STAFF_APP_ID = 'personal-staff';
const DEFAULT_MODEL = { provider: 'anthropic', id: 'claude-sonnet-4-6' };

async function backfillManagedApps() {
  const logger = new Logger('BackfillManagedApps');

  logger.log('Bootstrapping NestJS application context...');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const db = app.get<PostgresJsDatabase<typeof schema>>(DATABASE_CONNECTION);
  const applicationsService = app.get(ApplicationsService);
  const installedApplicationsService = app.get(InstalledApplicationsService);
  const personalStaffService = app.get(PersonalStaffService);

  const stats = {
    tenantsScanned: 0,
    appsInstalled: 0,
    personalStaffsCreated: 0,
    personalStaffsSkipped: 0,
    errors: 0,
  };

  try {
    // 1. Get all distinct active tenants
    const tenants = await db
      .select({
        id: schema.tenants.id,
        name: schema.tenants.name,
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.isActive, true));

    logger.log(`Found ${tenants.length} active tenants`);

    for (const tenant of tenants) {
      stats.tenantsScanned++;
      logger.log(`\n--- Processing tenant: ${tenant.name} (${tenant.id}) ---`);

      // 2. Get installed apps for this tenant
      const installedApps = await installedApplicationsService.findAllByTenant(
        tenant.id,
      );
      const installedAppIds = new Set(
        installedApps.map((a) => a.applicationId),
      );

      // 3. Find managed apps that should be auto-installed
      const managedApps = applicationsService
        .findAutoInstall()
        .filter((a) => a.type === 'managed' || a.autoInstall);

      // Get the first member as installer (usually the owner)
      const [firstMember] = await db
        .select({ userId: schema.tenantMembers.userId })
        .from(schema.tenantMembers)
        .where(
          and(
            eq(schema.tenantMembers.tenantId, tenant.id),
            isNull(schema.tenantMembers.leftAt),
          ),
        )
        .limit(1);

      if (!firstMember) {
        logger.warn(`  No active members found — skipping`);
        continue;
      }

      let personalStaffAppId: string | null = null;

      // 4. Install missing managed apps
      for (const managedApp of managedApps) {
        if (installedAppIds.has(managedApp.id)) {
          logger.log(`  ${managedApp.name} already installed`);
          if (managedApp.id === PERSONAL_STAFF_APP_ID) {
            // Find the installed app's row ID for personal staff creation
            const existing = installedApps.find(
              (a) => a.applicationId === PERSONAL_STAFF_APP_ID,
            );
            personalStaffAppId = existing?.id ?? null;
          }
          continue;
        }

        try {
          const installed = await installedApplicationsService.install(
            tenant.id,
            firstMember.userId,
            { applicationId: managedApp.id },
          );
          logger.log(`  Installed ${managedApp.name}`);
          stats.appsInstalled++;

          if (managedApp.id === PERSONAL_STAFF_APP_ID) {
            personalStaffAppId = installed.id;
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.warn(`  Failed to install ${managedApp.name}: ${msg}`);
          stats.errors++;
        }
      }

      // 5. For personal-staff: create a personal staff bot for each existing member
      if (!personalStaffAppId) {
        logger.log(`  No personal-staff app — skipping member backfill`);
        continue;
      }

      const members = await db
        .select({
          userId: schema.tenantMembers.userId,
          userType: schema.users.userType,
        })
        .from(schema.tenantMembers)
        .innerJoin(
          schema.users,
          eq(schema.tenantMembers.userId, schema.users.id),
        )
        .where(
          and(
            eq(schema.tenantMembers.tenantId, tenant.id),
            isNull(schema.tenantMembers.leftAt),
          ),
        );

      // Only create for human members
      const humanMembers = members.filter(
        (m) => m.userType !== 'bot' && m.userType !== 'system',
      );

      logger.log(
        `  Creating personal staff for ${humanMembers.length} human members...`,
      );

      for (const member of humanMembers) {
        try {
          await personalStaffService.createStaff(
            personalStaffAppId,
            tenant.id,
            member.userId,
            {
              model: DEFAULT_MODEL,
              agenticBootstrap: false, // Don't trigger bootstrap for backfill
            },
          );
          logger.log(`    Created personal staff for user ${member.userId}`);
          stats.personalStaffsCreated++;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          // ConflictException means the user already has a personal staff — skip
          if (msg.includes('already exists')) {
            logger.log(
              `    Skipped user ${member.userId} — already has personal staff`,
            );
            stats.personalStaffsSkipped++;
          } else {
            logger.warn(
              `    Failed to create personal staff for user ${member.userId}: ${msg}`,
            );
            stats.errors++;
          }
        }
      }
    }

    logger.log('\n=== Backfill Summary ===');
    logger.log(`Tenants scanned:        ${stats.tenantsScanned}`);
    logger.log(`Apps installed:         ${stats.appsInstalled}`);
    logger.log(`Personal staffs created: ${stats.personalStaffsCreated}`);
    logger.log(`Personal staffs skipped: ${stats.personalStaffsSkipped}`);
    logger.log(`Errors:                 ${stats.errors}`);
  } catch (error) {
    logger.error('Backfill script failed:', error);
    throw error;
  } finally {
    await app.close();
  }
}

backfillManagedApps()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
