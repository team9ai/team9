import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  pgEnum,
  index,
  integer,
  jsonb,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { tenants } from '../tenant/tenants.js';
import { channelSections } from './channel-sections.js';

export interface ChannelSnapshotMessage {
  id: string;
  content: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ChannelSnapshot {
  totalMessageCount: number;
  latestMessages: ChannelSnapshotMessage[];
}

export const channelTypeEnum = pgEnum('channel_type', [
  'direct',
  'public',
  'private',
  'task',
  'tracking',
  'echo',
]);

export const channels = pgTable(
  'im_channels',
  {
    id: uuid('id').primaryKey().notNull(),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    name: varchar('name', { length: 255 }),
    description: text('description'),
    type: channelTypeEnum('type').default('public').notNull(),
    avatarUrl: text('avatar_url'),
    createdBy: uuid('created_by').references(() => users.id),
    sectionId: uuid('section_id').references(() => channelSections.id, {
      onDelete: 'set null',
    }),
    order: integer('order').default(0).notNull(),
    isArchived: boolean('is_archived').default(false).notNull(),
    isActivated: boolean('is_activated').default(true).notNull(),
    snapshot: jsonb('snapshot').$type<ChannelSnapshot | null>(),
    propertySettings: jsonb('property_settings'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_channels_tenant').on(table.tenantId)],
);

export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
