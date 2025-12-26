import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { tenants } from '../tenant/tenants';

export const channelTypeEnum = pgEnum('channel_type', [
  'direct',
  'public',
  'private',
]);

export const channels = pgTable(
  'im_channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    name: varchar('name', { length: 255 }),
    description: text('description'),
    type: channelTypeEnum('type').default('public').notNull(),
    avatarUrl: text('avatar_url'),
    createdBy: uuid('created_by').references(() => users.id),
    isArchived: boolean('is_archived').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_channels_tenant').on(table.tenantId)],
);

export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
