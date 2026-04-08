import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schemas/index.js';
import { env } from '@team9/shared';

const ADVISORY_LOCK_ID = 9172034501;

export async function runSeed() {
  const connectionString = `postgresql://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${env.DB_HOST}:${env.DB_PORT}/${env.POSTGRES_DB}`;

  const client = postgres(connectionString);
  const _db = drizzle(client, { schema });

  try {
    await client.unsafe(`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_ID})`);

    // Check if default seed status exists
    let existing: unknown;
    try {
      existing = await client.unsafe(
        "SELECT key FROM __seed_status WHERE key = 'default'",
      );
    } catch (error) {
      // If table doesn't exist, that's expected on first run
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === '42P01'
      ) {
        // relation does not exist
        existing = undefined;
      } else {
        // Other errors should propagate
        throw error;
      }
    }

    if (!existing || (Array.isArray(existing) && existing.length === 0)) {
      // Create table and insert seed status
      await client.unsafe(
        'CREATE TABLE IF NOT EXISTS __seed_status (key TEXT PRIMARY KEY, seeded_at TIMESTAMP DEFAULT NOW())',
      );

      await client.unsafe(
        "INSERT INTO __seed_status (key) VALUES ('default') ON CONFLICT DO NOTHING",
      );
    }
  } finally {
    await client.end();
  }
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  runSeed()
    .then(() => {
      console.log('✅ Seeding completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Seeding failed:', error);
      process.exit(1);
    });
}
