CREATE TYPE "public"."file_visibility" AS ENUM('private', 'channel', 'workspace', 'public');--> statement-breakpoint
CREATE TABLE "im_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" varchar(500) NOT NULL,
	"bucket" varchar(255) NOT NULL,
	"file_name" varchar(500) NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"visibility" "file_visibility" DEFAULT 'workspace' NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_id" uuid,
	"uploader_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "im_files" ADD CONSTRAINT "im_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_files" ADD CONSTRAINT "im_files_channel_id_im_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."im_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_files" ADD CONSTRAINT "im_files_uploader_id_im_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."im_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_files_key" ON "im_files" USING btree ("key");--> statement-breakpoint
CREATE INDEX "idx_files_tenant" ON "im_files" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_files_channel" ON "im_files" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_files_uploader" ON "im_files" USING btree ("uploader_id");