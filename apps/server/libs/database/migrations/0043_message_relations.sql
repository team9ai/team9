CREATE TYPE "public"."relation_kind" AS ENUM('parent', 'related');--> statement-breakpoint
CREATE TABLE "im_message_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"channel_id" uuid NOT NULL,
	"source_message_id" uuid NOT NULL,
	"target_message_id" uuid NOT NULL,
	"property_definition_id" uuid NOT NULL,
	"relation_kind" "relation_kind" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_message_relation_edge" UNIQUE("source_message_id","property_definition_id","target_message_id"),
	CONSTRAINT "chk_message_relation_no_self" CHECK ("im_message_relations"."source_message_id" <> "im_message_relations"."target_message_id")
);
--> statement-breakpoint
ALTER TABLE "im_message_relations" ADD CONSTRAINT "im_message_relations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_message_relations" ADD CONSTRAINT "im_message_relations_channel_id_im_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."im_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_message_relations" ADD CONSTRAINT "im_message_relations_source_message_id_im_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."im_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_message_relations" ADD CONSTRAINT "im_message_relations_target_message_id_im_messages_id_fk" FOREIGN KEY ("target_message_id") REFERENCES "public"."im_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_message_relations" ADD CONSTRAINT "im_message_relations_property_definition_id_im_channel_property_definitions_id_fk" FOREIGN KEY ("property_definition_id") REFERENCES "public"."im_channel_property_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_message_relations" ADD CONSTRAINT "im_message_relations_created_by_im_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."im_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_mr_source_kind" ON "im_message_relations" USING btree ("source_message_id","relation_kind");--> statement-breakpoint
CREATE INDEX "idx_mr_target_kind" ON "im_message_relations" USING btree ("target_message_id","relation_kind");--> statement-breakpoint
CREATE INDEX "idx_mr_channel_kind" ON "im_message_relations" USING btree ("channel_id","relation_kind");--> statement-breakpoint
CREATE INDEX "idx_mr_propdef" ON "im_message_relations" USING btree ("property_definition_id");