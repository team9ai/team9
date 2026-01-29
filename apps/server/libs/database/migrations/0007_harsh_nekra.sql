CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'completed', 'failed', 'timeout');--> statement-breakpoint
CREATE TABLE "tracker_tasks" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"task_type" varchar(128) NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"metadata" jsonb,
	"params" jsonb,
	"result" jsonb,
	"error" jsonb,
	"progress_history" jsonb,
	"timeout_seconds" integer DEFAULT 86400 NOT NULL,
	"worker_id" varchar(128),
	"original_task_id" varchar(64),
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"timeout_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "idx_tasks_task_type" ON "tracker_tasks" USING btree ("task_type");--> statement-breakpoint
CREATE INDEX "idx_tasks_status" ON "tracker_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tasks_type_status" ON "tracker_tasks" USING btree ("task_type","status");--> statement-breakpoint
CREATE INDEX "idx_tasks_worker_id" ON "tracker_tasks" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_timeout_at" ON "tracker_tasks" USING btree ("timeout_at");--> statement-breakpoint
CREATE INDEX "idx_tasks_original_task_id" ON "tracker_tasks" USING btree ("original_task_id");