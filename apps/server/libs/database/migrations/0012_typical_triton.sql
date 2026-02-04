CREATE TYPE "public"."installed_application_status" AS ENUM('active', 'inactive', 'pending', 'error');--> statement-breakpoint
CREATE TABLE "im_installed_applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"icon_url" text,
	"tenant_id" uuid NOT NULL,
	"installed_by" uuid,
	"config" jsonb DEFAULT '{}'::jsonb,
	"secrets" jsonb DEFAULT '{}'::jsonb,
	"permissions" jsonb DEFAULT '{}'::jsonb,
	"status" "installed_application_status" DEFAULT 'active' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "im_installed_applications" ADD CONSTRAINT "im_installed_applications_installed_by_im_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."im_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_installed_applications_tenant_id" ON "im_installed_applications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_installed_applications_application_id" ON "im_installed_applications" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "idx_installed_applications_status" ON "im_installed_applications" USING btree ("status");