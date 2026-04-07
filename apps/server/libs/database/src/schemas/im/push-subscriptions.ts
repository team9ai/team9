import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const pushSubscriptions = pgTable(
  'im_push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: varchar('user_agent', { length: 512 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at'),
  },
  (table) => [
    unique('unique_push_endpoint').on(table.endpoint),
    index('idx_push_sub_user').on(table.userId),
  ],
);

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
