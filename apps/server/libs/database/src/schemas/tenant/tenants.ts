import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  pgEnum,
  jsonb,
} from 'drizzle-orm/pg-core';

export const tenantPlanEnum = pgEnum('tenant_plan', [
  'free',
  'pro',
  'enterprise',
]);

export interface TenantSettings {
  maxUsers?: number;
  maxChannels?: number;
  maxStorageMB?: number;
  features?: string[];
  branding?: {
    primaryColor?: string;
    logoUrl?: string;
  };
}

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 50 }).unique().notNull(),
  domain: varchar('domain', { length: 255 }).unique(),
  logoUrl: text('logo_url'),
  plan: tenantPlanEnum('plan').default('free').notNull(),
  settings: jsonb('settings').$type<TenantSettings>().default({}),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
