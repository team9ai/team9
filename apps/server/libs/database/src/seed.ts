import 'dotenv/config';
import postgres from 'postgres';
import { env } from '@team9/shared';

const ADVISORY_LOCK_ID = 9172034501;

export async function runSeed() {
  const connectionString = `postgresql://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${env.DB_HOST}:${env.DB_PORT}/${env.POSTGRES_DB}`;

  const client = postgres(connectionString, { max: 1 });

  try {
    // Ensure status table exists (outside transaction, so concurrent CREATE TABLE IF NOT EXISTS doesn't deadlock)
    await client.unsafe(
      'CREATE TABLE IF NOT EXISTS __seed_status (key TEXT PRIMARY KEY, seeded_at TIMESTAMP DEFAULT NOW())',
    );

    // Run all seed operations inside a transaction with advisory lock
    await client.begin(async (tx) => {
      // Acquire advisory lock (transaction-scoped, released at transaction end)
      await tx.unsafe(
        `SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_ID}::bigint)`,
      );

      // Check if default seed status exists
      const existing = (await tx.unsafe(
        "SELECT key FROM __seed_status WHERE key = 'default'",
      )) as Array<{ key: string }>;

      if (!existing || existing.length === 0) {
        // Insert seed status marker
        await tx.unsafe(
          "INSERT INTO __seed_status (key) VALUES ('default') ON CONFLICT DO NOTHING",
        );
        console.log('✅ Database seeded successfully');
      } else {
        console.log('ℹ️  Database already seeded, skipping');
      }
    });
  } finally {
    await client.end();
  }
}

// CLI entry — only runs when file is executed directly, not when imported.
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  (!!process.argv[1] && import.meta.url.endsWith(process.argv[1]));

if (isDirectRun) {
  runSeed()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Seeding failed:', error);
      process.exit(1);
    });
}
