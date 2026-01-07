CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "im_message_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"error_message" varchar(500)
);
--> statement-breakpoint
ALTER TABLE "im_message_outbox" ADD CONSTRAINT "im_message_outbox_message_id_im_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."im_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_outbox_status" ON "im_message_outbox" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_outbox_created" ON "im_message_outbox" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_outbox_message_id" ON "im_message_outbox" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_outbox_status_created" ON "im_message_outbox" USING btree ("status","created_at");