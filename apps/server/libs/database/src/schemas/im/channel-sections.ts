import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { tenants } from '../tenant/tenants.js';

export const channelSections = pgTable(
  'im_channel_sections',
  {
    id: uuid('id').primaryKey().notNull(),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    name: varchar('name', { length: 100 }).notNull(),
    order: integer('order').default(0).notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_channel_sections_tenant').on(table.tenantId)],
);

export type ChannelSection = typeof channelSections.$inferSelect;
export type NewChannelSection = typeof channelSections.$inferInsert;
