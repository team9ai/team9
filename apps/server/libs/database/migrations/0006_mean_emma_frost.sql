CREATE TABLE "im_channel_sections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"name" varchar(100) NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "im_channels" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "im_channels" ADD COLUMN "order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "im_channel_sections" ADD CONSTRAINT "im_channel_sections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_channel_sections" ADD CONSTRAINT "im_channel_sections_created_by_im_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."im_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_channel_sections_tenant" ON "im_channel_sections" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "im_channels" ADD CONSTRAINT "im_channels_section_id_im_channel_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."im_channel_sections"("id") ON DELETE set null ON UPDATE no action;