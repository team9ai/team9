CREATE TYPE "public"."notification_category" AS ENUM('message', 'system', 'workspace');--> statement-breakpoint
CREATE TYPE "public"."notification_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('mention', 'channel_mention', 'everyone_mention', 'here_mention', 'reply', 'thread_reply', 'dm_received', 'system_announcement', 'maintenance_notice', 'version_update', 'workspace_invitation', 'role_changed', 'member_joined', 'member_left', 'channel_invite');--> statement-breakpoint
CREATE TABLE "im_notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "notification_category" NOT NULL,
	"type" "notification_type" NOT NULL,
	"priority" "notification_priority" DEFAULT 'normal' NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text,
	"actor_id" uuid,
	"tenant_id" uuid,
	"channel_id" uuid,
	"message_id" uuid,
	"reference_type" varchar(50),
	"reference_id" uuid,
	"metadata" jsonb,
	"action_url" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp,
	"is_archived" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "im_channel_notification_mutes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"muted_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_channel_notification_mute" UNIQUE("user_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "im_notification_preferences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"mentions_enabled" boolean DEFAULT true NOT NULL,
	"replies_enabled" boolean DEFAULT true NOT NULL,
	"dms_enabled" boolean DEFAULT true NOT NULL,
	"system_enabled" boolean DEFAULT true NOT NULL,
	"workspace_enabled" boolean DEFAULT true NOT NULL,
	"desktop_enabled" boolean DEFAULT true NOT NULL,
	"sound_enabled" boolean DEFAULT true NOT NULL,
	"dnd_enabled" boolean DEFAULT false NOT NULL,
	"dnd_start" timestamp,
	"dnd_end" timestamp,
	"settings" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_user_notification_preferences" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "im_notifications" ADD CONSTRAINT "im_notifications_user_id_im_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."im_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_notifications" ADD CONSTRAINT "im_notifications_actor_id_im_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."im_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_notifications" ADD CONSTRAINT "im_notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_notifications" ADD CONSTRAINT "im_notifications_channel_id_im_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."im_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_notifications" ADD CONSTRAINT "im_notifications_message_id_im_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."im_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_channel_notification_mutes" ADD CONSTRAINT "im_channel_notification_mutes_user_id_im_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."im_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_channel_notification_mutes" ADD CONSTRAINT "im_channel_notification_mutes_channel_id_im_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."im_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_notification_preferences" ADD CONSTRAINT "im_notification_preferences_user_id_im_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."im_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_notifications_user_unread" ON "im_notifications" USING btree ("user_id","is_read","is_archived","created_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_user_category" ON "im_notifications" USING btree ("user_id","category","is_read");--> statement-breakpoint
CREATE INDEX "idx_notifications_user_type" ON "im_notifications" USING btree ("user_id","type","is_read");--> statement-breakpoint
CREATE INDEX "idx_notifications_expires" ON "im_notifications" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_reference" ON "im_notifications" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_message" ON "im_notifications" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_channel" ON "im_notifications" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_channel_mutes_user" ON "im_channel_notification_mutes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_channel_mutes_channel" ON "im_channel_notification_mutes" USING btree ("channel_id");