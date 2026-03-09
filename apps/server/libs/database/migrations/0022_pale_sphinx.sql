CREATE TYPE "public"."agent_task__trigger_type" AS ENUM('manual', 'interval', 'schedule', 'channel_message');--> statement-breakpoint
CREATE TYPE "public"."resource__status" AS ENUM('online', 'offline', 'error', 'configuring');--> statement-breakpoint
CREATE TYPE "public"."resource__type" AS ENUM('agent_computer', 'api');--> statement-breakpoint
CREATE TYPE "public"."resource__actor_type" AS ENUM('agent', 'user');--> statement-breakpoint
CREATE TABLE "agent_task__triggers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"type" "agent_task__trigger_type" NOT NULL,
	"config" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp,
	"last_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "resource__type" NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"config" jsonb NOT NULL,
	"status" "resource__status" DEFAULT 'offline' NOT NULL,
	"authorizations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_heartbeat_at" timestamp,
	"creator_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_usage_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"resource_id" uuid NOT NULL,
	"actor_type" "resource__actor_type" NOT NULL,
	"actor_id" uuid NOT NULL,
	"task_id" uuid,
	"execution_id" uuid,
	"action" varchar(64) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_task__executions" ADD COLUMN "trigger_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_task__executions" ADD COLUMN "trigger_type" varchar(32);--> statement-breakpoint
ALTER TABLE "agent_task__executions" ADD COLUMN "trigger_context" jsonb;--> statement-breakpoint
ALTER TABLE "agent_task__executions" ADD COLUMN "document_version_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_task__executions" ADD COLUMN "source_execution_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_task__triggers" ADD CONSTRAINT "agent_task__triggers_task_id_agent_task__tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_task__tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_creator_id_im_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."im_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_usage_logs" ADD CONSTRAINT "resource_usage_logs_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_usage_logs" ADD CONSTRAINT "resource_usage_logs_task_id_agent_task__tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_task__tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_usage_logs" ADD CONSTRAINT "resource_usage_logs_execution_id_agent_task__executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."agent_task__executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_task__triggers_task_id" ON "agent_task__triggers" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_agent_task__triggers_scan" ON "agent_task__triggers" USING btree ("type","enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "idx_resources_tenant_id" ON "resources" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_resources_tenant_type" ON "resources" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE INDEX "idx_resources_status" ON "resources" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_resource_usage_logs_resource_created" ON "resource_usage_logs" USING btree ("resource_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_resource_usage_logs_actor_created" ON "resource_usage_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
ALTER TABLE "agent_task__executions" ADD CONSTRAINT "agent_task__executions_trigger_id_agent_task__triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."agent_task__triggers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task__executions" ADD CONSTRAINT "agent_task__executions_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;