import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  pgEnum,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const installedApplicationStatusEnum = pgEnum(
  'installed_application_status',
  ['active', 'inactive', 'pending', 'error'],
);

export interface ApplicationConfig {
  webhookUrl?: string;
  settings?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ApplicationSecrets {
  [key: string]: unknown;
}

export interface ApplicationPermissions {
  canReadMessages?: boolean;
  canSendMessages?: boolean;
  canManageChannels?: boolean;
  canAccessFiles?: boolean;
  scopes?: string[];
  [key: string]: unknown;
}

export const installedApplications = pgTable(
  'im_installed_applications',
  {
    id: uuid('id').primaryKey().notNull(),

    // Application identifier (e.g., 'github', 'jira', 'custom-app-123')
    applicationId: varchar('application_id', { length: 255 }).notNull(),

    // Application icon URL
    iconUrl: text('icon_url'),

    // Tenant/Workspace ID (stored as uuid, not FK to keep im schema independent)
    tenantId: uuid('tenant_id').notNull(),

    // User who installed this application
    installedBy: uuid('installed_by').references(() => users.id, {
      onDelete: 'set null',
    }),

    // Application configuration (webhook URLs, settings, etc.)
    config: jsonb('config').$type<ApplicationConfig>().default({}),

    // Sensitive secrets (API keys, tokens, etc.) - never return to frontend
    secrets: jsonb('secrets').$type<ApplicationSecrets>().default({}),

    // Application permissions
    permissions: jsonb('permissions')
      .$type<ApplicationPermissions>()
      .default({}),

    // Application status
    status: installedApplicationStatusEnum('status')
      .default('active')
      .notNull(),

    // Whether the application is enabled
    isActive: boolean('is_active').default(true).notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_installed_applications_tenant_id').on(table.tenantId),
    index('idx_installed_applications_application_id').on(table.applicationId),
    index('idx_installed_applications_status').on(table.status),
  ],
);

export type InstalledApplication = typeof installedApplications.$inferSelect;
export type NewInstalledApplication = typeof installedApplications.$inferInsert;
