import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and, isNull, isNotNull } from 'drizzle-orm';
import * as schema from '../schemas/index.js';

/**
 * Fix script: Correct installed application tenantId based on bot's actual workspace membership
 *
 * Problem:
 *   The migrate-bots-to-applications script determined tenantId from the bot OWNER's
 *   first workspace membership. For users with multiple workspaces, this could assign
 *   the wrong tenantId to the installed application.
 *
 * Fix:
 *   Look up which workspace the BOT USER actually joined (via tenant_members),
 *   and update the installed application's tenantId to match.
 */

function getConnectionString(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

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

  if (password) {
    return `postgresql://${user}:${password}@${host}:${port}/${database}`;
  }
  return `postgresql://${user}@${host}:${port}/${database}`;
}

async function fixApplicationTenantIds() {
  const connectionString = getConnectionString();

  console.log('=== Fixing installed application tenantIds ===\n');

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    // 1. Get all bots that have an installed application
    const botsWithApps = await db
      .select({
        botId: schema.bots.id,
        botUserId: schema.bots.userId,
        ownerId: schema.bots.ownerId,
        installedApplicationId: schema.bots.installedApplicationId,
      })
      .from(schema.bots)
      .where(isNotNull(schema.bots.installedApplicationId));

    console.log(
      `Found ${botsWithApps.length} bots with installed applications\n`,
    );

    let fixed = 0;
    let alreadyCorrect = 0;
    let noMembership = 0;
    let errors = 0;

    for (const bot of botsWithApps) {
      try {
        console.log(`[Bot ${bot.botId}] Processing...`);

        // 2. Get the bot user's actual workspace membership
        const [botMembership] = await db
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
              eq(schema.tenantMembers.userId, bot.botUserId),
              isNull(schema.tenantMembers.leftAt),
            ),
          )
          .limit(1);

        if (!botMembership) {
          console.log(`    WARNING: Bot user has no workspace membership`);
          noMembership++;
          continue;
        }

        // 3. Get the current installed application
        const [application] = await db
          .select({
            id: schema.installedApplications.id,
            tenantId: schema.installedApplications.tenantId,
          })
          .from(schema.installedApplications)
          .where(
            eq(schema.installedApplications.id, bot.installedApplicationId!),
          );

        if (!application) {
          console.log(`    WARNING: Installed application not found`);
          errors++;
          continue;
        }

        // 4. Compare and fix if needed
        if (application.tenantId === botMembership.tenantId) {
          console.log(
            `    Already correct: ${botMembership.tenantName} (${botMembership.tenantId})`,
          );
          alreadyCorrect++;
          continue;
        }

        console.log(`    MISMATCH FOUND:`);
        console.log(`      Application tenantId: ${application.tenantId}`);
        console.log(
          `      Bot's actual workspace: ${botMembership.tenantName} (${botMembership.tenantId})`,
        );

        // 5. Update the installed application's tenantId
        await db
          .update(schema.installedApplications)
          .set({
            tenantId: botMembership.tenantId,
            updatedAt: new Date(),
          })
          .where(eq(schema.installedApplications.id, application.id));

        console.log(`    FIXED: Updated tenantId to ${botMembership.tenantId}`);
        fixed++;
      } catch (error) {
        console.error(`    Error processing bot ${bot.botId}:`, error);
        errors++;
      }
    }

    console.log('\n=== Fix Summary ===');
    console.log(`Fixed:            ${fixed}`);
    console.log(`Already correct:  ${alreadyCorrect}`);
    console.log(`No membership:    ${noMembership}`);
    console.log(`Errors:           ${errors}`);
    console.log(`Total:            ${botsWithApps.length}`);
  } catch (error) {
    console.error('Fix script failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

fixApplicationTenantIds()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
