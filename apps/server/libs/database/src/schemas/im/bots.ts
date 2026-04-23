import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  pgEnum,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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

export type DmOutboundPolicyMode =
  | 'owner-only'
  | 'same-tenant'
  | 'whitelist'
  | 'anyone';

export interface DmOutboundPolicy {
  mode: DmOutboundPolicyMode;
  /** Required iff `mode === 'whitelist'`. Max 50 entries (enforced at DTO layer). */
  userIds?: string[];
}

export interface BotExtra {
  openclaw?: {
    agentId?: string; // OpenClaw agent ID; absent means default agent
    workspace?: string; // OpenClaw workspace name; absent means "default"
  };
  commonStaff?: {
    roleTitle?: string;
    persona?: string;
    jobDescription?: string;
    model?: { provider: string; id: string };
    /**
     * Free-form identity facts surfaced to the agent via
     * `StaffProfileSnapshot.identity`. Shallow-merged by the
     * `bot-staff-profile` PATCH endpoint's `identityPatch` field.
     * `name` (if present) is mirrored to `im_users.display_name` in
     * the same transaction to keep display parity.
     */
    identity?: Record<string, unknown>;
  };
  personalStaff?: {
    persona?: string;
    model?: { provider: string; id: string };
    visibility?: {
      allowMention?: boolean;
      allowDirectMessage?: boolean;
    };
    /**
     * ISO-8601 timestamp of the first successful
     * `team9:bootstrap.start` dispatch. Set after the onboarding wizard
     * fires the agentic greeting so that onboarding retries (e.g. after a
     * downstream `provisionCommonStaff` failure) do not re-fire and
     * duplicate the greeting. Absent means bootstrap has not yet run.
     */
    bootstrappedAt?: string;
    /** See commonStaff.identity. Role/jobDescription are system-fixed for personal staff. */
    identity?: Record<string, unknown>;
  };
  /** Outbound DM policy. Absent ⇒ gateway computes default from bot shape. */
  dmOutboundPolicy?: DmOutboundPolicy;
}

export interface ManagedMeta {
  agentId?: string; // claw-hive agent ID
  instanceId?: string; // openclaw instance ID
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

    // Flexible extension data (e.g. openclaw.agentId)
    extra: jsonb('extra').$type<BotExtra>().default({}),

    // Managed bot provider (e.g. "hive", "openclaw")
    // null = unmanaged (custom/webhook)
    managedProvider: text('managed_provider'),

    // Provider-specific metadata (e.g. { agentId: "base-model-claude" })
    managedMeta: jsonb('managed_meta').$type<ManagedMeta>(),

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
    index('idx_bots_access_token').using(
      'btree',
      table.accessToken.op('text_pattern_ops'),
    ),
    uniqueIndex('bots_owner_app_unique')
      .on(table.ownerId, table.installedApplicationId)
      .where(
        sql`${table.ownerId} IS NOT NULL AND ${table.installedApplicationId} IS NOT NULL AND ${table.extra}->>'personalStaff' IS NOT NULL`,
      ),
  ],
);

export type Bot = typeof bots.$inferSelect;
export type NewBot = typeof bots.$inferInsert;
