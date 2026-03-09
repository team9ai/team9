import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from '../tenant/tenants.js';
import { users } from '../im/users.js';

// ── Enums ────────────────────────────────────────────────────────────

export const resourceTypeEnum = pgEnum('resource__type', [
  'agent_computer',
  'api',
]);

export const resourceStatusEnum = pgEnum('resource__status', [
  'online',
  'offline',
  'error',
  'configuring',
]);

// ── Types ────────────────────────────────────────────────────────────

export interface AgentComputerConfig {
  connectionType: 'ahand' | 'ssh' | 'cloud';
  host?: string;
  port?: number;
  os?: string;
  arch?: string;
}

export interface ApiResourceConfig {
  provider: string;
  baseUrl?: string;
  apiKey: string;
  model?: string;
}

export type ResourceConfig = AgentComputerConfig | ApiResourceConfig;

export interface ResourceAuthorization {
  granteeType: 'user' | 'task';
  granteeId: string;
  permissions: { level: 'full' | 'readonly' };
  grantedBy: string;
  grantedAt: string;
}

// ── Table ────────────────────────────────────────────────────────────

export const resources = pgTable(
  'resources',
  {
    id: uuid('id').primaryKey().notNull(),

    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),

    type: resourceTypeEnum('type').notNull(),

    name: varchar('name', { length: 255 }).notNull(),

    description: text('description'),

    config: jsonb('config').$type<ResourceConfig>().notNull(),

    status: resourceStatusEnum('status').default('offline').notNull(),

    authorizations: jsonb('authorizations')
      .$type<ResourceAuthorization[]>()
      .default([])
      .notNull(),

    lastHeartbeatAt: timestamp('last_heartbeat_at'),

    creatorId: uuid('creator_id')
      .references(() => users.id)
      .notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_resources_tenant_id').on(table.tenantId),
    index('idx_resources_tenant_type').on(table.tenantId, table.type),
    index('idx_resources_status').on(table.status),
  ],
);

export type Resource = typeof resources.$inferSelect;
export type NewResource = typeof resources.$inferInsert;
export type ResourceType = (typeof resourceTypeEnum.enumValues)[number];
export type ResourceStatus = (typeof resourceStatusEnum.enumValues)[number];
