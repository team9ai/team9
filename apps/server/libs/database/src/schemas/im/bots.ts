import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  pgEnum,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { installedApplications } from './installed-applications.js';

export const botTypeEnum = pgEnum('bot_type', ['system', 'custom', 'webhook']);

export interface BotCapabilities {
  canSendMessages?: boolean;
  canReadMessages?: boolean;
  canManageChannels?: boolean;
  canManageMembers?: boolean;
  supportedCommands?: string[];
  aiModel?: string;
  [key: string]: unknown;
}

export const bots = pgTable(
  'im_bots',
  {
    id: uuid('id').primaryKey().notNull(),

    // FK to the shadow user row in im_users
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .unique()
      .notNull(),

    // Bot classification
    type: botTypeEnum('type').default('system').notNull(),

    // Owner (null for system bots, set for custom/webhook bots)
    ownerId: uuid('owner_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    // Mentor / supervisor who oversees this AI Staff
    mentorId: uuid('mentor_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    // Optional: The installed application that created this bot
    installedApplicationId: uuid('installed_application_id').references(
      () => installedApplications.id,
      { onDelete: 'set null' },
    ),

    description: text('description'),

    // Flexible capabilities descriptor
    capabilities: jsonb('capabilities').$type<BotCapabilities>().default({}),

    // Webhook integration
    webhookUrl: text('webhook_url'),

    // Custom headers sent with webhook requests (e.g. { "Authorization": "Bearer xxx" })
    webhookHeaders: jsonb('webhook_headers')
      .$type<Record<string, string>>()
      .default({}),

    // Access token for API authentication (hashed: fingerprint:bcryptHash)
    accessToken: text('access_token'),
    isActive: boolean('is_active').default(true).notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_bots_user_id').on(table.userId),
    index('idx_bots_type').on(table.type),
    index('idx_bots_owner_id').on(table.ownerId),
    index('idx_bots_mentor_id').on(table.mentorId),
    index('idx_bots_installed_application_id').on(table.installedApplicationId),
    index('idx_bots_access_token').on(table.accessToken),
  ],
);

export type Bot = typeof bots.$inferSelect;
export type NewBot = typeof bots.$inferInsert;
