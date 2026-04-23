-- im_ahand_devices: registry of ahand daemons attached to Team9 users.
--
-- Ownership is polymorphic via (owner_type, owner_id). We don't use a DB FK
-- because the target table depends on owner_type ("user" → im_users,
-- "workspace" → tenants in a later phase). A CHECK constraint guards valid
-- owner_type values. hub_device_id is the SHA256 of the device's Ed25519
-- public key — globally unique by construction.
--
-- See specs/2026-04-22-ahand-integration-design.md § 3.2.

CREATE TABLE IF NOT EXISTS "im_ahand_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"hub_device_id" text NOT NULL,
	"public_key" text NOT NULL,
	"nickname" text NOT NULL,
	"platform" text NOT NULL,
	"hostname" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "im_ahand_devices_hub_device_id_unique" UNIQUE("hub_device_id"),
	CONSTRAINT "im_ahand_devices_owner_type_check" CHECK ("owner_type" IN ('user', 'workspace')),
	CONSTRAINT "im_ahand_devices_status_check" CHECK ("status" IN ('active', 'revoked'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ahand_devices_owner_idx" ON "im_ahand_devices" ("owner_type","owner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ahand_devices_status_idx" ON "im_ahand_devices" ("status");
