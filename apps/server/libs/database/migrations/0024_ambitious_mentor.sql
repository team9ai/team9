ALTER TABLE "tracker_tasks" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "tracker_tasks" CASCADE;--> statement-breakpoint
ALTER TABLE "agent_task__executions" RENAME COLUMN "version" TO "task_version";--> statement-breakpoint
DROP INDEX "idx_agent_task__executions_task_version";--> statement-breakpoint
ALTER TABLE "agent_task__tasks" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_agent_task__executions_task_version" ON "agent_task__executions" USING btree ("task_id","task_version");--> statement-breakpoint
DROP TYPE "public"."task_status";