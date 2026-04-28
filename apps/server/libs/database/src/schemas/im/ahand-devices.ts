import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';

// ahand_devices tracks every ahand daemon registered against a Team9 user
// (future: workspace). Ownership is polymorphic via (owner_type, owner_id):
// no DB-level FK because the target table depends on owner_type. A CHECK
// constraint in the migration guards valid values.
//
// See specs/2026-04-22-ahand-integration-design.md § 3.2.
export const ahandDevices = pgTable(
  'im_ahand_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Polymorphic ownership. MVP populates "user"; "workspace" is a follow-up.
    ownerType: text('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),

    // ahand identity as assigned by the hub. hub_device_id is the SHA256 of
    // the Ed25519 public key and therefore globally unique.
    hubDeviceId: text('hub_device_id').notNull().unique(),
    publicKey: text('public_key').notNull(),

    // Human-facing metadata.
    nickname: text('nickname').notNull(),
    platform: text('platform').notNull(),
    hostname: text('hostname'),

    // ahandd's self-declared capabilities, stored as TEXT[] to mirror aHand
    // hub's `devices.capabilities` schema (crates/ahand-hub-store/migrations/0001_initial.sql).
    // Examples: ["exec"], ["exec","browser"]. Empty array means "device row exists
    // but ahandd has not yet completed Hello / hub has not pushed caps yet"; the
    // worker treats this as 'shell-only' (run_command).
    capabilities: text('capabilities')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    // Lifecycle state.
    status: text('status').notNull().default('active'),
    lastSeenAt: timestamp('last_seen_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    revokedAt: timestamp('revoked_at'),
  },
  (t) => [
    index('ahand_devices_owner_idx').on(t.ownerType, t.ownerId),
    index('ahand_devices_status_idx').on(t.status),
  ],
);

export type AhandDevice = typeof ahandDevices.$inferSelect;
export type NewAhandDevice = typeof ahandDevices.$inferInsert;
