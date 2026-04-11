CREATE TYPE "public"."property_value_type" AS ENUM('text', 'number', 'boolean', 'single_select', 'multi_select', 'person', 'date', 'timestamp', 'date_range', 'timestamp_range', 'recurring', 'url', 'message_ref', 'file', 'image', 'tags');--> statement-breakpoint
CREATE TABLE "im_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" varchar(50) NOT NULL,
	"changes" jsonb NOT NULL,
	"performed_by" uuid,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "im_channel_property_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"key" varchar(100) NOT NULL,
	"description" text,
	"value_type" "property_value_type" NOT NULL,
	"is_native" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"ai_auto_fill" boolean DEFAULT true NOT NULL,
	"ai_auto_fill_prompt" text,
	"is_required" boolean DEFAULT false NOT NULL,
	"default_value" jsonb,
	"show_in_chat_policy" varchar(20) DEFAULT 'auto' NOT NULL,
	"allow_new_options" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_channel_property_def_key" UNIQUE("channel_id","key")
);
--> statement-breakpoint
CREATE TABLE "im_channel_tabs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" varchar(30) NOT NULL,
	"view_id" uuid,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "im_channel_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" varchar(20) NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "im_message_properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"property_definition_id" uuid NOT NULL,
	"text_value" text,
	"number_value" double precision,
	"boolean_value" boolean,
	"date_value" timestamp,
	"json_value" jsonb,
	"file_key" varchar(500),
	"file_metadata" jsonb,
	"order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_message_property" UNIQUE("message_id","property_definition_id")
);
--> statement-breakpoint
ALTER TABLE "im_channels" ADD COLUMN "property_settings" jsonb;--> statement-breakpoint
ALTER TABLE "im_audit_logs" ADD CONSTRAINT "im_audit_logs_channel_id_im_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."im_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_audit_logs" ADD CONSTRAINT "im_audit_logs_performed_by_im_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."im_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_channel_property_definitions" ADD CONSTRAINT "im_channel_property_definitions_channel_id_im_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."im_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_channel_property_definitions" ADD CONSTRAINT "im_channel_property_definitions_created_by_im_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."im_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_channel_tabs" ADD CONSTRAINT "im_channel_tabs_channel_id_im_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."im_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_channel_tabs" ADD CONSTRAINT "im_channel_tabs_view_id_im_channel_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."im_channel_views"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_channel_tabs" ADD CONSTRAINT "im_channel_tabs_created_by_im_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."im_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_channel_views" ADD CONSTRAINT "im_channel_views_channel_id_im_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."im_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_channel_views" ADD CONSTRAINT "im_channel_views_created_by_im_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."im_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_message_properties" ADD CONSTRAINT "im_message_properties_message_id_im_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."im_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_message_properties" ADD CONSTRAINT "im_message_properties_property_definition_id_im_channel_property_definitions_id_fk" FOREIGN KEY ("property_definition_id") REFERENCES "public"."im_channel_property_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_message_properties" ADD CONSTRAINT "im_message_properties_created_by_im_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."im_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_message_properties" ADD CONSTRAINT "im_message_properties_updated_by_im_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."im_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_logs_channel_created" ON "im_audit_logs" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_entity" ON "im_audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_performer" ON "im_audit_logs" USING btree ("performed_by","created_at");--> statement-breakpoint
CREATE INDEX "idx_channel_property_def_order" ON "im_channel_property_definitions" USING btree ("channel_id","order");--> statement-breakpoint
CREATE INDEX "idx_channel_tabs_channel" ON "im_channel_tabs" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_channel_views_channel" ON "im_channel_views" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_message_props_message" ON "im_message_properties" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_message_props_def_text" ON "im_message_properties" USING btree ("property_definition_id","text_value");--> statement-breakpoint
CREATE INDEX "idx_message_props_def_number" ON "im_message_properties" USING btree ("property_definition_id","number_value");--> statement-breakpoint
CREATE INDEX "idx_message_props_def_date" ON "im_message_properties" USING btree ("property_definition_id","date_value");--> statement-breakpoint
CREATE INDEX "idx_message_props_def_boolean" ON "im_message_properties" USING btree ("property_definition_id","boolean_value");--> statement-breakpoint
CREATE INDEX "idx_message_props_json_gin" ON "im_message_properties" USING GIN ("json_value");