CREATE INDEX IF NOT EXISTS "idx_task__runs_channel_id" ON "task__runs" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_routine__executions_channel_id" ON "routine__executions" USING btree ("channel_id");
