import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const channelTypeEnum = pgEnum('channel_type', [
  'direct',
  'public',
  'private',
]);

export const channels = pgTable('im_channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }),
  description: text('description'),
  type: channelTypeEnum('type').default('public').notNull(),
  avatarUrl: text('avatar_url'),
  createdBy: uuid('created_by').references(() => users.id),
  isArchived: boolean('is_archived').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
