import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schemas';
import { config } from './schemas/config';
import { env } from '@team9/shared';

async function seed() {
  const connectionString = `postgresql://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${env.DB_HOST}:${env.DB_PORT}/${env.POSTGRES_DB}`;

  console.log('🌱 Seeding database...');

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    // Insert default configurations
    const defaultConfigs = [
      {
        key: 'AI_SERVICE_HOST',
        value: String(env.AI_SERVICE_HOST),
        description: 'AI microservice host address',
        isSecret: false,
      },
      {
        key: 'AI_SERVICE_PORT',
        value: String(env.AI_SERVICE_PORT),
        description: 'AI microservice port',
        isSecret: false,
      },
    ];

    for (const cfg of defaultConfigs) {
      await db
        .insert(config)
        .values(cfg)
        .onConflictDoUpdate({
          target: config.key,
          set: {
            value: cfg.value,
            description: cfg.description,
            isSecret: cfg.isSecret,
            updatedAt: new Date(),
          },
        });
      console.log(`✓ Inserted/Updated config: ${cfg.key}`);
    }

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
