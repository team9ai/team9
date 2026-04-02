import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schemas/index.js';
import { env } from '@team9/shared';

async function seed() {
  const connectionString = `postgresql://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${env.DB_HOST}:${env.DB_PORT}/${env.POSTGRES_DB}`;

  console.log('🌱 Seeding database...');

  const client = postgres(connectionString);
  const _db = drizzle(client, { schema });

  try {
    // Add seed data here as needed
    console.log('✅ Seeding completed successfully!');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

seed()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
