import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { v7 as uuidv7 } from 'uuid';
import { eq, and, isNull, isNotNull, asc } from 'drizzle-orm';
import * as schema from '../schemas/index.js';
import type {
  ApplicationConfig,
  ApplicationSecrets,
  ApplicationPermissions,
} from '../schemas/im/installed-applications.js';

/**
 * Migration script: Migrate existing bots to the new installed application model
 *
 * This script:
 * 1. For each bot with an owner, creates a corresponding installed application
 * 2. Migrates bot's accessToken, webhookUrl, webhookHeaders to the application's secrets/config
 * 3. Stores instancesId (currently botUserId) in the config for OpenClaw compatibility
 * 4. Links the bot to the installed application via installedApplicationId
 * 5. If a user has multiple workspaces, the application is created in the first workspace
 */

function getConnectionString(): string {
  // Try DATABASE_URL first
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  // Fall back to individual env vars
  const user = process.env.POSTGRES_USER;
  const password = process.env.POSTGRES_PASSWORD;
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT;
  const database = process.env.POSTGRES_DB;

  if (!user || !host || !port || !database) {
    console.error(
      'Missing database configuration. Set DATABASE_URL or POSTGRES_USER, DB_HOST, DB_PORT, POSTGRES_DB',
    );
    process.exit(1);
  }

  // Password is optional for local development
  if (password) {
    return `postgresql://${user}:${password}@${host}:${port}/${database}`;
  }
  return `postgresql://${user}@${host}:${port}/${database}`;
}

async function migrateBotToApplication() {
  const connectionString = getConnectionString();

  console.log('=== Migrating bots to installed applications ===\n');

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    // 1. Get all bots that have an owner (custom/webhook bots, not system bots)
    const botsToMigrate = await db
      .select({
        id: schema.bots.id,
        userId: schema.bots.userId,
        type: schema.bots.type,
        ownerId: schema.bots.ownerId,
        capabilities: schema.bots.capabilities,
        webhookUrl: schema.bots.webhookUrl,
        webhookHeaders: schema.bots.webhookHeaders,
        accessToken: schema.bots.accessToken,
        installedApplicationId: schema.bots.installedApplicationId,
        createdAt: schema.bots.createdAt,
      })
      .from(schema.bots)
      .where(
        and(
          isNotNull(schema.bots.ownerId),
          isNull(schema.bots.installedApplicationId),
        ),
      );

    console.log(`Found ${botsToMigrate.length} bots to migrate\n`);

    if (botsToMigrate.length === 0) {
      console.log(
        'No bots need migration. All bots already have installed applications.',
      );
      return;
    }

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const bot of botsToMigrate) {
      try {
        console.log(`[Bot ${bot.id}] Processing...`);

        // 2. Get the owner's first workspace (by joinedAt)
        const [ownerMembership] = await db
          .select({
            tenantId: schema.tenantMembers.tenantId,
            tenantName: schema.tenants.name,
          })
          .from(schema.tenantMembers)
          .innerJoin(
            schema.tenants,
            eq(schema.tenantMembers.tenantId, schema.tenants.id),
          )
          .where(
            and(
              eq(schema.tenantMembers.userId, bot.ownerId!),
              isNull(schema.tenantMembers.leftAt),
            ),
          )
          .orderBy(asc(schema.tenantMembers.joinedAt))
          .limit(1);

        if (!ownerMembership) {
          console.log(`    Skipping: Owner has no active workspace membership`);
          skipped++;
          continue;
        }

        console.log(
          `    Workspace: ${ownerMembership.tenantName} (${ownerMembership.tenantId})`,
        );

        // 4. Build the application config
        // instancesId is the current OpenClaw instance ID (previously was userId/botUserId)
        const config: ApplicationConfig = {
          instancesId: bot.userId, // Current OpenClaw instances use botUserId as the ID
        };

        if (bot.webhookUrl) {
          config.webhookUrl = bot.webhookUrl;
        }

        // 5. Build the application secrets
        const secrets: ApplicationSecrets = {};

        if (bot.accessToken) {
          secrets.accessToken = bot.accessToken;
        }

        if (bot.webhookHeaders && Object.keys(bot.webhookHeaders).length > 0) {
          secrets.webhookHeaders = bot.webhookHeaders;
        }

        // 6. Map capabilities to permissions
        const permissions: ApplicationPermissions = {};
        if (bot.capabilities) {
          if (bot.capabilities.canReadMessages) {
            permissions.canReadMessages = true;
          }
          if (bot.capabilities.canSendMessages) {
            permissions.canSendMessages = true;
          }
          if (bot.capabilities.canManageChannels) {
            permissions.canManageChannels = true;
          }
        }

        // 7. Create the installed application
        const applicationId = uuidv7();

        await db.insert(schema.installedApplications).values({
          id: applicationId,
          applicationId: 'openclaw', // All migrated bots are OpenClaw applications
          tenantId: ownerMembership.tenantId,
          installedBy: bot.ownerId,
          config,
          secrets,
          permissions,
          status: 'active',
          isActive: true,
          createdAt: bot.createdAt, // Preserve original creation time
          updatedAt: new Date(),
        });

        console.log(`    Created application: ${applicationId}`);

        // 8. Link the bot to the installed application
        await db
          .update(schema.bots)
          .set({
            installedApplicationId: applicationId,
            updatedAt: new Date(),
          })
          .where(eq(schema.bots.id, bot.id));

        console.log(`    Linked bot to application`);
        migrated++;
      } catch (error) {
        console.error(`    Error migrating bot ${bot.id}:`, error);
        errors++;
      }
    }

    console.log('\n=== Migration Summary ===');
    console.log(`Migrated: ${migrated}`);
    console.log(`Skipped:  ${skipped}`);
    console.log(`Errors:   ${errors}`);
    console.log(`Total:    ${botsToMigrate.length}`);
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

migrateBotToApplication()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
