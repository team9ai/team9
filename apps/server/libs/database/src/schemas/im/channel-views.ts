import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { channels } from './channels.js';
import { users } from './users.js';

export const channelViews = pgTable(
  'im_channel_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .references(() => channels.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    type: varchar('type', { length: 20 }).notNull(),
    config: jsonb('config').default({}).notNull(),
    order: integer('order').default(0).notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_channel_views_channel').on(table.channelId)],
);

export type ChannelView = typeof channelViews.$inferSelect;
export type NewChannelView = typeof channelViews.$inferInsert;
