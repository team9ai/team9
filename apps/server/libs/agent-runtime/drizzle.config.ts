import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: [
    '../agent-framework/src/storage/postgres/schema.ts',
    './src/db/schema.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DEBUGGER_DB_URL ||
      'postgres://postgres:postgres@localhost:5432/debugger',
  },
});
