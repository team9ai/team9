ALTER TYPE "public"."message_type" ADD VALUE 'forward';--> statement-breakpoint
CREATE TABLE "im_message_forwards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"forwarded_message_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"source_message_id" uuid,
	"source_channel_id" uuid NOT NULL,
	"source_workspace_id" uuid,
	"source_sender_id" uuid,
	"source_created_at" timestamp NOT NULL,
	"source_seq_id" bigint,
	"content_snapshot" varchar(100000),
	"content_ast_snapshot" jsonb,
	"attachments_snapshot" jsonb,
	"source_type" varchar(32) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "im_message_forwards" ADD CONSTRAINT "im_message_forwards_forwarded_message_id_im_messages_id_fk" FOREIGN KEY ("forwarded_message_id") REFERENCES "public"."im_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_message_forwards" ADD CONSTRAINT "im_message_forwards_source_message_id_im_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."im_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_message_forwards" ADD CONSTRAINT "im_message_forwards_source_channel_id_im_channels_id_fk" FOREIGN KEY ("source_channel_id") REFERENCES "public"."im_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_message_forwards" ADD CONSTRAINT "im_message_forwards_source_workspace_id_tenants_id_fk" FOREIGN KEY ("source_workspace_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_message_forwards" ADD CONSTRAINT "im_message_forwards_source_sender_id_im_users_id_fk" FOREIGN KEY ("source_sender_id") REFERENCES "public"."im_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_mf_forwarded" ON "im_message_forwards" USING btree ("forwarded_message_id");--> statement-breakpoint
CREATE INDEX "idx_mf_source_msg" ON "im_message_forwards" USING btree ("source_message_id");--> statement-breakpoint
CREATE INDEX "idx_mf_source_channel" ON "im_message_forwards" USING btree ("source_channel_id");--> statement-breakpoint
CREATE INDEX "idx_mf_source_workspace" ON "im_message_forwards" USING btree ("source_workspace_id");