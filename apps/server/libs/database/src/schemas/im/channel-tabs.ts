import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { channels } from './channels.js';
import { channelViews } from './channel-views.js';
import { users } from './users.js';

export const channelTabs = pgTable(
  'im_channel_tabs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .references(() => channels.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    type: varchar('type', { length: 30 }).notNull(),
    viewId: uuid('view_id').references(() => channelViews.id),
    isBuiltin: boolean('is_builtin').default(false).notNull(),
    order: integer('order').default(0).notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_channel_tabs_channel').on(table.channelId)],
);

export type ChannelTab = typeof channelTabs.$inferSelect;
export type NewChannelTab = typeof channelTabs.$inferInsert;
