-- im_hive_send_failures: dead-letter table for ClawHiveService.sendInput
-- failures from the im-worker post-broadcast fan-out.
--
-- processTask marks the outbox `completed` BEFORE sendInput resolves
-- (fire-and-forget — see post-broadcast.service.ts:864-887), so a failed
-- send is otherwise only visible as a single WARN log line. This table
-- lets the dispatch path persist the failure with enough context for
-- replay or audit, paired with the `im.hive.send_failures` OTEL counter.
--
-- See issue #77.

CREATE TABLE IF NOT EXISTS "im_hive_send_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"tenant_id" uuid,
	"session_id" text NOT NULL,
	"tracking_channel_id" uuid,
	"error_kind" text NOT NULL,
	"error_message" text NOT NULL,
	"retry_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "im_hive_send_failures_message_id_im_messages_id_fk"
		FOREIGN KEY ("message_id") REFERENCES "public"."im_messages"("id")
		ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "im_hive_send_failures_bot_id_im_bots_id_fk"
		FOREIGN KEY ("bot_id") REFERENCES "public"."im_bots"("id")
		ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hive_send_failures_msg_bot_unique" ON "im_hive_send_failures" USING btree ("message_id","bot_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hive_send_failures_agent_idx" ON "im_hive_send_failures" USING btree ("agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hive_send_failures_tenant_idx" ON "im_hive_send_failures" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hive_send_failures_last_seen_idx" ON "im_hive_send_failures" USING btree ("last_seen_at");
