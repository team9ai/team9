import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import * as schema from '../schemas/index.js';

/**
 * Migration: Convert existing task schedules to the triggers table.
 *
 * For each existing task:
 * - If scheduleType = 'recurring' and scheduleConfig exists:
 *   create a 'schedule' trigger with the config, copy nextRunAt
 * - Always create a default 'manual' trigger so every task has at least one
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

async function migrateTaskTriggers() {
  const connectionString = getConnectionString();

  console.log('=== Migrating existing task schedules to triggers table ===\n');

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    // 1. Fetch all tasks
    const tasks = await db
      .select({
        id: schema.routines.id,
        scheduleType: schema.routines.scheduleType,
        scheduleConfig: schema.routines.scheduleConfig,
        nextRunAt: schema.routines.nextRunAt,
      })
      .from(schema.routines);

    console.log(`Found ${tasks.length} tasks\n`);

    let manualCreated = 0;
    let scheduleCreated = 0;
    let skipped = 0;
    let errors = 0;

    for (const task of tasks) {
      try {
        // Check if task already has triggers (idempotent)
        const existingTriggers = await db
          .select({ id: schema.routineTriggers.id })
          .from(schema.routineTriggers)
          .where(eq(schema.routineTriggers.routineId, task.id))
          .limit(1);

        if (existingTriggers.length > 0) {
          console.log(`[Task ${task.id}] Already has triggers, skipping`);
          skipped++;
          continue;
        }

        const now = new Date();

        // Always create a manual trigger
        await db.insert(schema.routineTriggers).values({
          id: uuidv7(),
          routineId: task.id,
          type: 'manual',
          config: {},
          enabled: true,
          createdAt: now,
          updatedAt: now,
        });
        manualCreated++;

        // If recurring with config, create a schedule trigger
        if (task.scheduleType === 'recurring' && task.scheduleConfig) {
          const config = task.scheduleConfig as Record<string, unknown>;
          const frequency =
            typeof config.frequency === 'string' ? config.frequency : 'daily';
          const schedTriggerConfig: Record<string, unknown> = {
            frequency,
            time: config.time ?? '09:00',
            timezone: config.timezone ?? 'UTC',
          };
          if (config.dayOfWeek !== undefined) {
            schedTriggerConfig.dayOfWeek = config.dayOfWeek;
          }
          if (config.dayOfMonth !== undefined) {
            schedTriggerConfig.dayOfMonth = config.dayOfMonth;
          }

          await db.insert(schema.routineTriggers).values({
            id: uuidv7(),
            routineId: task.id,
            type: 'schedule',
            config:
              schedTriggerConfig as unknown as schema.ScheduleTriggerConfig,
            enabled: true,
            nextRunAt: task.nextRunAt ?? null,
            createdAt: now,
            updatedAt: now,
          });
          scheduleCreated++;
          console.log(
            `[Task ${task.id}] Created manual + schedule trigger (${frequency})`,
          );
        } else {
          console.log(`[Task ${task.id}] Created manual trigger`);
        }
      } catch (error) {
        console.error(`[Task ${task.id}] Error:`, error);
        errors++;
      }
    }

    console.log('\n=== Migration Summary ===');
    console.log(`Manual triggers created:   ${manualCreated}`);
    console.log(`Schedule triggers created: ${scheduleCreated}`);
    console.log(`Skipped (already had):     ${skipped}`);
    console.log(`Errors:                    ${errors}`);
    console.log(`Total tasks:               ${tasks.length}`);
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

migrateTaskTriggers()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
