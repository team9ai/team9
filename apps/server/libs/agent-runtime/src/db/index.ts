import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

let db: PostgresJsDatabase<Record<string, never>> | null = null;
let client: ReturnType<typeof postgres> | null = null;

/**
 * Get database URL from environment variables
 * Supports DEBUGGER_DB_URL or falls back to individual config
 */
export function getDatabaseUrl(): string | null {
  // Prefer DEBUGGER_DB_URL
  if (process.env.DEBUGGER_DB_URL) {
    return process.env.DEBUGGER_DB_URL;
  }

  // Fallback to individual config
  const config = getDatabaseConfig();
  if (config) {
    return `postgres://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`;
  }

  return null;
}

/**
 * Get database configuration from environment variables
 */
export function getDatabaseConfig(): DatabaseConfig | null {
  const host = process.env.DB_HOST || process.env.POSTGRES_HOST;
  const port = process.env.DB_PORT || process.env.POSTGRES_PORT;
  const user = process.env.DB_USER || process.env.POSTGRES_USER;
  const password = process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD;
  const database = process.env.DB_NAME || process.env.POSTGRES_DB;

  if (!host || !user || !password || !database) {
    return null;
  }

  return {
    host,
    port: parseInt(port || '5432', 10),
    user,
    password,
    database,
  };
}

/**
 * Initialize database connection from URL
 */
export async function initDatabaseFromUrl(
  url: string,
): Promise<PostgresJsDatabase<Record<string, never>>> {
  if (db) {
    return db;
  }

  client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  db = drizzle(client);

  // Parse URL for logging (hide password)
  const urlObj = new URL(url);
  console.log(`Database connected: ${urlObj.host}${urlObj.pathname}`);

  return db;
}

/**
 * Initialize database connection from config
 * @deprecated Use initDatabaseFromUrl instead
 */
export async function initDatabase(
  config: DatabaseConfig,
): Promise<PostgresJsDatabase<Record<string, never>>> {
  const connectionString = `postgres://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`;
  return initDatabaseFromUrl(connectionString);
}

/**
 * Get the database instance
 */
export function getDatabase(): PostgresJsDatabase<
  Record<string, never>
> | null {
  return db;
}

/**
 * Close database connection
 */
export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.end();
    client = null;
    db = null;
    console.log('Database connection closed');
  }
}

export type { PostgresJsDatabase };
export * from './schema.js';
