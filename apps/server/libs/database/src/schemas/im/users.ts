import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const userStatusEnum = pgEnum('user_status', [
  'online',
  'offline',
  'away',
  'busy',
]);

export const userTypeEnum = pgEnum('user_type', ['human', 'bot', 'system']);

export const users = pgTable('im_users', {
  id: uuid('id').primaryKey().notNull(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  username: varchar('username', { length: 100 }).unique().notNull(),
  displayName: varchar('display_name', { length: 255 }),
  avatarUrl: text('avatar_url'),
  passwordHash: text('password_hash'),
  status: userStatusEnum('status').default('offline').notNull(),
  lastSeenAt: timestamp('last_seen_at'),
  isActive: boolean('is_active').default(true).notNull(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  emailVerifiedAt: timestamp('email_verified_at'),
  userType: userTypeEnum('user_type').default('human').notNull(),
  // IETF BCP 47 language tag (e.g. "en", "zh-CN", "ja"). Populated by the
  // client on authenticated bootstrap, consumed by gateway services that
  // emit bootstrap events to claw-hive so the agent can greet the user in
  // their preferred language.
  language: varchar('language', { length: 16 }),
  // IANA time zone name (e.g. "Asia/Shanghai", "America/New_York"). Same
  // delivery model as `language` — client writes it, gateway reads it when
  // composing bootstrap event payloads.
  timeZone: varchar('time_zone', { length: 64 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
