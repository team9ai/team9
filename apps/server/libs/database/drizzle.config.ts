import { defineConfig } from 'drizzle-kit';
import { env } from '@team9/shared';

export default defineConfig({
  schema: './src/schemas/*',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_DB,
  },
});
