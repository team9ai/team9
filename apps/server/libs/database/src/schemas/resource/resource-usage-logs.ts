import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { resources } from './resources.js';
import { routines } from '../routine/routines.js';
import { routineExecutions } from '../routine/routine-executions.js';

// ── Enums ────────────────────────────────────────────────────────────

export const resourceActorTypeEnum = pgEnum('resource__actor_type', [
  'agent',
  'user',
]);

// ── Table ────────────────────────────────────────────────────────────

export const resourceUsageLogs = pgTable(
  'resource_usage_logs',
  {
    id: uuid('id').primaryKey().notNull(),

    resourceId: uuid('resource_id')
      .references(() => resources.id, { onDelete: 'cascade' })
      .notNull(),

    actorType: resourceActorTypeEnum('actor_type').notNull(),

    actorId: uuid('actor_id').notNull(),

    routineId: uuid('routine_id').references(() => routines.id),

    executionId: uuid('execution_id').references(() => routineExecutions.id),

    action: varchar('action', { length: 64 }).notNull(),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_resource_usage_logs_resource_created').on(
      table.resourceId,
      table.createdAt,
    ),
    index('idx_resource_usage_logs_actor_created').on(
      table.actorId,
      table.createdAt,
    ),
  ],
);

export type ResourceUsageLog = typeof resourceUsageLogs.$inferSelect;
export type NewResourceUsageLog = typeof resourceUsageLogs.$inferInsert;
