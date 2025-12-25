import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schemas';
import { config } from './schemas/config';

async function seed() {
  const connectionString = `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@localhost:${process.env.DB_PORT || '5432'}/${process.env.POSTGRES_DB || 'team9'}`;

  console.log('🌱 Seeding database...');

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    // Insert default configurations
    const defaultConfigs = [
      {
        key: 'AI_SERVICE_HOST',
        value: process.env.AI_SERVICE_HOST || 'localhost',
        description: 'AI microservice host address',
        isSecret: false,
      },
      {
        key: 'AI_SERVICE_PORT',
        value: process.env.AI_SERVICE_PORT || '3001',
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
