import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { env } from '@team9/shared';
import { Logger } from '@nestjs/common';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function runMigrations(): Promise<void> {
  const logger = new Logger('DatabaseMigration');

  const user = env.POSTGRES_USER;
  const password = env.POSTGRES_PASSWORD;
  const host = env.DB_HOST;
  const port = env.DB_PORT;
  const database = env.POSTGRES_DB;

  logger.log(`Running migrations on ${host}:${port}/${database}`);

  // Create a separate connection for migrations
  const migrationClient = postgres({
    host,
    port,
    database,
    username: user,
    password,
    max: 1,
  });

  const db = drizzle(migrationClient);

  try {
    // Migrations folder is relative to the compiled dist folder
    const migrationsFolder = join(__dirname, '..', 'migrations');
    logger.log(`Migrations folder: ${migrationsFolder}`);

    await migrate(db, { migrationsFolder });
    logger.log('Migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed:', error);
    throw error;
  } finally {
    await migrationClient.end();
  }
}
