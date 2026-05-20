ALTER TABLE "task__runs" ADD COLUMN IF NOT EXISTS "hidden_at" timestamp;--> statement-breakpoint
ALTER TABLE "task__runs" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task__runs_hidden_at" ON "task__runs" USING btree ("hidden_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task__runs_archived_at" ON "task__runs" USING btree ("archived_at");
