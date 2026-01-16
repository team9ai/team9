ALTER TABLE "im_messages" ADD COLUMN "root_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_messages_root_id" ON "im_messages" USING btree ("root_id");