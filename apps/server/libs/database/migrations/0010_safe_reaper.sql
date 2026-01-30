CREATE TYPE "public"."bot_type" AS ENUM('system', 'custom', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."user_type" AS ENUM('human', 'bot', 'system');--> statement-breakpoint
CREATE TABLE "im_bots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "bot_type" DEFAULT 'system' NOT NULL,
	"owner_id" uuid,
	"description" text,
	"capabilities" jsonb DEFAULT '{}'::jsonb,
	"webhook_url" text,
	"access_token" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "im_bots_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "im_users" ADD COLUMN "user_type" "user_type" DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "im_bots" ADD CONSTRAINT "im_bots_user_id_im_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."im_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_bots" ADD CONSTRAINT "im_bots_owner_id_im_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."im_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_bots_user_id" ON "im_bots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_bots_type" ON "im_bots" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_bots_owner_id" ON "im_bots" USING btree ("owner_id");