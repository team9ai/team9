import { defineConfig } from 'drizzle-kit';

const dbCredentials = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.POSTGRES_USER,
  database: process.env.POSTGRES_DB,
};

// Only add password if it's set (support passwordless local dev)
if (process.env.POSTGRES_PASSWORD) {
  dbCredentials.password = process.env.POSTGRES_PASSWORD;
}

export default defineConfig({
  schema: './dist/schemas/**/*.js',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials,
});
