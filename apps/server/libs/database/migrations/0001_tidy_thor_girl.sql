CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."channel_type" AS ENUM('direct', 'public', 'private');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('online', 'offline', 'away', 'busy');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'file', 'image', 'system');--> statement-breakpoint
CREATE TYPE "public"."mention_type" AS ENUM('user', 'channel', 'everyone', 'here');--> statement-breakpoint
CREATE TABLE "im_channel_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"is_muted" boolean DEFAULT false NOT NULL,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"left_at" timestamp,
	CONSTRAINT "unique_channel_user" UNIQUE("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "im_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255),
	"description" text,
	"type" "channel_type" DEFAULT 'public' NOT NULL,
	"avatar_url" text,
	"created_by" uuid,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "im_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"username" varchar(100) NOT NULL,
	"display_name" varchar(255),
	"avatar_url" text,
	"password_hash" text NOT NULL,
	"status" "user_status" DEFAULT 'offline' NOT NULL,
	"last_seen_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "im_users_email_unique" UNIQUE("email"),
	CONSTRAINT "im_users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "im_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"sender_id" uuid,
	"parent_id" uuid,
	"content" text,
	"type" "message_type" DEFAULT 'text' NOT NULL,
	"metadata" jsonb,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"is_edited" boolean DEFAULT false NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "im_message_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"file_name" varchar(500) NOT NULL,
	"file_key" varchar(500) NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"thumbnail_url" text,
	"width" integer,
	"height" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "im_message_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_reaction" UNIQUE("message_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "im_user_channel_read_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"last_read_message_id" uuid,
	"last_read_at" timestamp DEFAULT now() NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "unique_user_channel_read" UNIQUE("user_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "im_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"mentioned_user_id" uuid,
	"mentioned_channel_id" uuid,
	"type" "mention_type" NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "im_channel_members" ADD CONSTRAINT "im_channel_members_channel_id_im_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."im_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_channel_members" ADD CONSTRAINT "im_channel_members_user_id_im_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."im_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_channels" ADD CONSTRAINT "im_channels_created_by_im_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."im_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_messages" ADD CONSTRAINT "im_messages_channel_id_im_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."im_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_messages" ADD CONSTRAINT "im_messages_sender_id_im_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."im_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_message_attachments" ADD CONSTRAINT "im_message_attachments_message_id_im_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."im_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_message_reactions" ADD CONSTRAINT "im_message_reactions_message_id_im_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."im_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_message_reactions" ADD CONSTRAINT "im_message_reactions_user_id_im_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."im_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_user_channel_read_status" ADD CONSTRAINT "im_user_channel_read_status_user_id_im_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."im_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_user_channel_read_status" ADD CONSTRAINT "im_user_channel_read_status_channel_id_im_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."im_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_user_channel_read_status" ADD CONSTRAINT "im_user_channel_read_status_last_read_message_id_im_messages_id_fk" FOREIGN KEY ("last_read_message_id") REFERENCES "public"."im_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_mentions" ADD CONSTRAINT "im_mentions_message_id_im_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."im_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_mentions" ADD CONSTRAINT "im_mentions_mentioned_user_id_im_users_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."im_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_mentions" ADD CONSTRAINT "im_mentions_mentioned_channel_id_im_channels_id_fk" FOREIGN KEY ("mentioned_channel_id") REFERENCES "public"."im_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_messages_channel_id" ON "im_messages" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_messages_sender_id" ON "im_messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "idx_messages_parent_id" ON "im_messages" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_messages_created_at" ON "im_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_mentions_user_id" ON "im_mentions" USING btree ("mentioned_user_id");--> statement-breakpoint
CREATE INDEX "idx_mentions_message_id" ON "im_mentions" USING btree ("message_id");