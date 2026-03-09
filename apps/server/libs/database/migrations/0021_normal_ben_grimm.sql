CREATE TYPE "public"."agent_task__schedule_type" AS ENUM('once', 'recurring');--> statement-breakpoint
CREATE TYPE "public"."agent_task__status" AS ENUM('upcoming', 'in_progress', 'paused', 'pending_action', 'completed', 'failed', 'stopped', 'timeout');--> statement-breakpoint
CREATE TYPE "public"."agent_task__step_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."agent_task__intervention_status" AS ENUM('pending', 'resolved', 'expired');--> statement-breakpoint
ALTER TYPE "public"."channel_type" ADD VALUE 'task';--> statement-breakpoint
CREATE TABLE "agent_task__tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bot_id" uuid,
	"creator_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"status" "agent_task__status" DEFAULT 'upcoming' NOT NULL,
	"schedule_type" "agent_task__schedule_type" DEFAULT 'once' NOT NULL,
	"schedule_config" jsonb,
	"next_run_at" timestamp,
	"document_id" uuid,
	"current_execution_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_task__executions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "agent_task__status" DEFAULT 'in_progress' NOT NULL,
	"channel_id" uuid,
	"taskcast_task_id" varchar(128),
	"token_usage" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"duration" integer,
	"error" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_agent_task__executions_taskcast" UNIQUE("taskcast_task_id")
);
--> statement-breakpoint
CREATE TABLE "agent_task__steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"execution_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"order_index" integer NOT NULL,
	"title" varchar(500) NOT NULL,
	"status" "agent_task__step_status" DEFAULT 'pending' NOT NULL,
	"token_usage" integer DEFAULT 0 NOT NULL,
	"duration" integer,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_task__deliverables" (
	"id" uuid PRIMARY KEY NOT NULL,
	"execution_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"file_name" varchar(500) NOT NULL,
	"file_size" bigint,
	"mime_type" varchar(128),
	"file_url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_task__interventions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"execution_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"step_id" uuid,
	"prompt" text NOT NULL,
	"actions" jsonb NOT NULL,
	"response" jsonb,
	"status" "agent_task__intervention_status" DEFAULT 'pending' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_task__tasks" ADD CONSTRAINT "agent_task__tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task__tasks" ADD CONSTRAINT "agent_task__tasks_bot_id_im_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."im_bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task__tasks" ADD CONSTRAINT "agent_task__tasks_creator_id_im_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."im_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task__tasks" ADD CONSTRAINT "agent_task__tasks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task__executions" ADD CONSTRAINT "agent_task__executions_task_id_agent_task__tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_task__tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task__executions" ADD CONSTRAINT "agent_task__executions_channel_id_im_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."im_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task__steps" ADD CONSTRAINT "agent_task__steps_execution_id_agent_task__executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."agent_task__executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task__steps" ADD CONSTRAINT "agent_task__steps_task_id_agent_task__tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_task__tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task__deliverables" ADD CONSTRAINT "agent_task__deliverables_execution_id_agent_task__executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."agent_task__executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task__deliverables" ADD CONSTRAINT "agent_task__deliverables_task_id_agent_task__tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_task__tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task__interventions" ADD CONSTRAINT "agent_task__interventions_execution_id_agent_task__executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."agent_task__executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task__interventions" ADD CONSTRAINT "agent_task__interventions_task_id_agent_task__tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_task__tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task__interventions" ADD CONSTRAINT "agent_task__interventions_step_id_agent_task__steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."agent_task__steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task__interventions" ADD CONSTRAINT "agent_task__interventions_resolved_by_im_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."im_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_task__tasks_tenant_id" ON "agent_task__tasks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_agent_task__tasks_bot_id" ON "agent_task__tasks" USING btree ("bot_id");--> statement-breakpoint
CREATE INDEX "idx_agent_task__tasks_creator_id" ON "agent_task__tasks" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "idx_agent_task__tasks_status" ON "agent_task__tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_agent_task__tasks_next_run_at" ON "agent_task__tasks" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "idx_agent_task__tasks_tenant_status" ON "agent_task__tasks" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_agent_task__executions_task_id" ON "agent_task__executions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_agent_task__executions_status" ON "agent_task__executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_agent_task__executions_task_version" ON "agent_task__executions" USING btree ("task_id","version");--> statement-breakpoint
CREATE INDEX "idx_agent_task__steps_execution_id" ON "agent_task__steps" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "idx_agent_task__steps_task_id" ON "agent_task__steps" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_agent_task__deliverables_execution_id" ON "agent_task__deliverables" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "idx_agent_task__deliverables_task_id" ON "agent_task__deliverables" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_agent_task__interventions_execution_id" ON "agent_task__interventions" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "idx_agent_task__interventions_task_id" ON "agent_task__interventions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_agent_task__interventions_status" ON "agent_task__interventions" USING btree ("status");