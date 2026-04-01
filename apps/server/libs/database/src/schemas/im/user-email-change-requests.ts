import {
  pgEnum,
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

export const userEmailChangeRequestStatusEnum = pgEnum(
  'user_email_change_request_status',
  ['pending', 'confirmed', 'cancelled', 'expired'],
);

export const userEmailChangeRequests = pgTable(
  'im_user_email_change_requests',
  {
    id: uuid('id').primaryKey().notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    currentEmail: varchar('current_email', { length: 255 }).notNull(),
    newEmail: varchar('new_email', { length: 255 }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).unique().notNull(),
    status: userEmailChangeRequestStatusEnum('status')
      .default('pending')
      .notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    confirmedAt: timestamp('confirmed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_user_email_change_requests_user_id').on(table.userId),
    index('idx_user_email_change_requests_status').on(table.status),
    index('idx_user_email_change_requests_expires_at').on(table.expiresAt),
    uniqueIndex('uq_user_email_change_requests_pending_user')
      .on(table.userId)
      .where(sql`${table.status} = 'pending'`),
    uniqueIndex('uq_user_email_change_requests_pending_new_email')
      .on(table.newEmail)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export type UserEmailChangeRequest =
  typeof userEmailChangeRequests.$inferSelect;
export type NewUserEmailChangeRequest =
  typeof userEmailChangeRequests.$inferInsert;
