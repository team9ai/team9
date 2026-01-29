import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const emailVerificationTokens = pgTable(
  'im_email_verification_tokens',
  {
    id: uuid('id').primaryKey().notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    token: varchar('token', { length: 64 }).unique().notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_verification_tokens_user_id').on(table.userId),
    index('idx_verification_tokens_token').on(table.token),
    index('idx_verification_tokens_expires_at').on(table.expiresAt),
  ],
);

export type EmailVerificationToken =
  typeof emailVerificationTokens.$inferSelect;
export type NewEmailVerificationToken =
  typeof emailVerificationTokens.$inferInsert;
