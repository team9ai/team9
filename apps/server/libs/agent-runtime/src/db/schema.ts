import { pgTable, varchar, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

// Re-export blueprints from agent-framework
export { blueprints } from '@team9/agent-framework';

/**
 * Agents table
 * Stores agent instance metadata
 */
export const agents = pgTable(
  'agents',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    blueprintId: varchar('blueprint_id', { length: 64 }),
    name: varchar('name', { length: 255 }).notNull(),
    threadId: varchar('thread_id', { length: 64 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('running'),
    data: jsonb('data').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('agents_blueprint_id_idx').on(table.blueprintId),
    index('agents_thread_id_idx').on(table.threadId),
    index('agents_status_idx').on(table.status),
    index('agents_created_at_idx').on(table.createdAt),
  ],
);

// Type exports
export type AgentRow = typeof agents.$inferSelect;
export type NewAgentRow = typeof agents.$inferInsert;
