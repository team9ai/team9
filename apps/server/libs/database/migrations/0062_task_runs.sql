CREATE TYPE "public"."task__run_status" AS ENUM('draft', 'upcoming', 'in_progress', 'paused', 'pending_action', 'completed', 'failed', 'stopped', 'timeout');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "task__runs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "routine_id" uuid,
  "routine_version" integer,
  "bot_id" uuid,
  "creator_id" uuid NOT NULL,
  "title" varchar(500) NOT NULL,
  "description" text,
  "status" "task__run_status" DEFAULT 'upcoming' NOT NULL,
  "channel_id" uuid,
  "taskcast_task_id" varchar(128),
  "token_usage" integer DEFAULT 0 NOT NULL,
  "started_at" timestamp,
  "completed_at" timestamp,
  "duration" integer,
  "error" jsonb,
  "trigger_id" uuid,
  "trigger_type" varchar(32),
  "trigger_context" jsonb,
  "document_version_id" uuid,
  "source_run_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "task__runs" ADD CONSTRAINT "task__runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task__runs" ADD CONSTRAINT "task__runs_routine_id_routine__routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routine__routines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task__runs" ADD CONSTRAINT "task__runs_bot_id_im_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."im_bots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task__runs" ADD CONSTRAINT "task__runs_creator_id_im_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."im_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task__runs" ADD CONSTRAINT "task__runs_channel_id_im_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."im_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task__runs" ADD CONSTRAINT "task__runs_trigger_id_routine__triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."routine__triggers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task__runs" ADD CONSTRAINT "task__runs_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_task__runs_tenant_id" ON "task__runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task__runs_routine_id" ON "task__runs" USING btree ("routine_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task__runs_bot_id" ON "task__runs" USING btree ("bot_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task__runs_creator_id" ON "task__runs" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task__runs_status" ON "task__runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task__runs_tenant_status" ON "task__runs" USING btree ("tenant_id", "status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_task__runs_taskcast" ON "task__runs" USING btree ("taskcast_task_id");--> statement-breakpoint

INSERT INTO "task__runs" (
  "id",
  "tenant_id",
  "routine_id",
  "routine_version",
  "bot_id",
  "creator_id",
  "title",
  "description",
  "status",
  "channel_id",
  "taskcast_task_id",
  "token_usage",
  "started_at",
  "completed_at",
  "duration",
  "error",
  "trigger_id",
  "trigger_type",
  "trigger_context",
  "document_version_id",
  "source_run_id",
  "created_at",
  "updated_at"
)
SELECT
  e."id",
  r."tenant_id",
  e."routine_id",
  e."routine_version",
  r."bot_id",
  r."creator_id",
  r."title",
  r."description",
  e."status"::text::"task__run_status",
  e."channel_id",
  e."taskcast_task_id",
  e."token_usage",
  e."started_at",
  e."completed_at",
  e."duration",
  e."error",
  e."trigger_id",
  e."trigger_type",
  e."trigger_context",
  e."document_version_id",
  e."source_execution_id",
  e."created_at",
  now()
FROM "routine__executions" e
JOIN "routine__routines" r ON r."id" = e."routine_id"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "task__deliverables" (
  "id" uuid PRIMARY KEY NOT NULL,
  "run_id" uuid NOT NULL,
  "routine_id" uuid,
  "file_name" varchar(500) NOT NULL,
  "file_size" bigint,
  "mime_type" varchar(128),
  "file_url" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "task__deliverables" ADD CONSTRAINT "task__deliverables_run_id_task__runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."task__runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task__deliverables" ADD CONSTRAINT "task__deliverables_routine_id_routine__routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routine__routines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_task__deliverables_run_id" ON "task__deliverables" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task__deliverables_routine_id" ON "task__deliverables" USING btree ("routine_id");--> statement-breakpoint

INSERT INTO "task__deliverables" (
  "id",
  "run_id",
  "routine_id",
  "file_name",
  "file_size",
  "mime_type",
  "file_url",
  "created_at"
)
SELECT
  d."id",
  d."execution_id",
  d."routine_id",
  d."file_name",
  d."file_size",
  d."mime_type",
  d."file_url",
  d."created_at"
FROM "routine__deliverables" d
JOIN "task__runs" r ON r."id" = d."execution_id"
ON CONFLICT ("id") DO NOTHING;
