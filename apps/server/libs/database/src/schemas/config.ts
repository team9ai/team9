import {
  pgTable,
  varchar,
  timestamp,
  text,
  boolean,
} from 'drizzle-orm/pg-core';

/**
 * System configuration table
 * Stores key-value pairs for application configuration
 */
export const config = pgTable('config', {
  key: varchar('key', { length: 255 }).primaryKey(),
  value: text('value').notNull(),
  description: text('description'),
  isSecret: boolean('is_secret').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Config = typeof config.$inferSelect;
export type NewConfig = typeof config.$inferInsert;
