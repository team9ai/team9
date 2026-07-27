ALTER TABLE "im_model_change_attempts" ADD COLUMN "bot_user_id" uuid;--> statement-breakpoint
ALTER TABLE "im_model_change_outbox" ADD COLUMN "published_at" timestamp;--> statement-breakpoint
ALTER TABLE "im_model_change_outbox" ADD COLUMN "publication_claim_token" uuid;--> statement-breakpoint
ALTER TABLE "im_model_change_outbox" ADD COLUMN "publication_claim_until" timestamp;--> statement-breakpoint
ALTER TABLE "im_model_change_outbox" ADD COLUMN "publication_retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "im_model_change_outbox" ADD COLUMN "publication_safe_error_code" varchar(128);--> statement-breakpoint
CREATE INDEX "idx_model_change_outbox_publication" ON "im_model_change_outbox" USING btree ("status","published_at","publication_claim_until");
