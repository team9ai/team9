import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { channels } from './channels.js';
import { users } from './users.js';

export const auditLogs = pgTable(
  'im_audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id').references(() => channels.id),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    action: varchar('action', { length: 50 }).notNull(),
    changes: jsonb('changes').notNull(),
    performedBy: uuid('performed_by').references(() => users.id),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_audit_logs_channel_created').on(
      table.channelId,
      table.createdAt,
    ),
    index('idx_audit_logs_entity').on(table.entityType, table.entityId),
    index('idx_audit_logs_performer').on(table.performedBy, table.createdAt),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
