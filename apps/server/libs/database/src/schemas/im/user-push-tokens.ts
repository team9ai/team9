import {
  pgTable,
  uuid,
  varchar,
  pgEnum,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const pushPlatformEnum = pgEnum('push_platform', ['ios', 'android']);

export const userPushTokens = pgTable(
  'im_user_push_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    token: varchar('token', { length: 512 }).notNull(),
    platform: pushPlatformEnum('platform').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('uq_user_push_token').on(table.userId, table.token),
    index('idx_user_push_tokens_user_id').on(table.userId),
  ],
);

export type UserPushToken = typeof userPushTokens.$inferSelect;
export type NewUserPushToken = typeof userPushTokens.$inferInsert;
export type PushPlatform = (typeof pushPlatformEnum.enumValues)[number];
