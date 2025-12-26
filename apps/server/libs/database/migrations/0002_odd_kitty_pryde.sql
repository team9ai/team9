CREATE TYPE "public"."tenant_plan" AS ENUM('free', 'pro', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."tenant_role" AS ENUM('owner', 'admin', 'member', 'guest');--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(50) NOT NULL,
	"domain" varchar(255),
	"logo_url" text,
	"plan" "tenant_plan" DEFAULT 'free' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "tenant_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "tenant_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"invited_by" uuid,
	CONSTRAINT "unique_tenant_user" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "im_channels" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_user_id_im_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."im_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_invited_by_im_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."im_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_channels" ADD CONSTRAINT "im_channels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_channels_tenant" ON "im_channels" USING btree ("tenant_id");