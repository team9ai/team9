import { pgTable, varchar, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

/**
 * Memory threads table
 * Stores thread metadata with JSONB data
 */
export const memoryThreads = pgTable(
  'memory_threads',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    data: jsonb('data').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('memory_threads_created_at_idx').on(table.createdAt)],
);

/**
 * Memory chunks table
 * Stores chunk data with JSONB
 */
export const memoryChunks = pgTable(
  'memory_chunks',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    threadId: varchar('thread_id', { length: 64 }),
    data: jsonb('data').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('memory_chunks_thread_id_idx').on(table.threadId),
    index('memory_chunks_created_at_idx').on(table.createdAt),
  ],
);

/**
 * Memory states table
 * Stores state data with JSONB
 */
export const memoryStates = pgTable(
  'memory_states',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    threadId: varchar('thread_id', { length: 64 }),
    data: jsonb('data').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('memory_states_thread_id_idx').on(table.threadId),
    index('memory_states_created_at_idx').on(table.createdAt),
  ],
);

/**
 * Blueprints table
 * Stores agent blueprint configurations
 */
export const blueprints = pgTable(
  'blueprints',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    data: jsonb('data').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('blueprints_name_idx').on(table.name),
    index('blueprints_created_at_idx').on(table.createdAt),
  ],
);

// Type exports for Drizzle
export type MemoryThreadRow = typeof memoryThreads.$inferSelect;
export type NewMemoryThreadRow = typeof memoryThreads.$inferInsert;

export type MemoryChunkRow = typeof memoryChunks.$inferSelect;
export type NewMemoryChunkRow = typeof memoryChunks.$inferInsert;

export type MemoryStateRow = typeof memoryStates.$inferSelect;
export type NewMemoryStateRow = typeof memoryStates.$inferInsert;

export type BlueprintRow = typeof blueprints.$inferSelect;
export type NewBlueprintRow = typeof blueprints.$inferInsert;
