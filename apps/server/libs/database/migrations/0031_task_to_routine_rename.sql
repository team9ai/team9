-- Rename enums: agent_task__* → routine__*
ALTER TYPE "public"."agent_task__status" RENAME TO "routine__status";--> statement-breakpoint
ALTER TYPE "public"."agent_task__schedule_type" RENAME TO "routine__schedule_type";--> statement-breakpoint
ALTER TYPE "public"."agent_task__step_status" RENAME TO "routine__step_status";--> statement-breakpoint
ALTER TYPE "public"."agent_task__intervention_status" RENAME TO "routine__intervention_status";--> statement-breakpoint
ALTER TYPE "public"."agent_task__trigger_type" RENAME TO "routine__trigger_type";--> statement-breakpoint

-- Rename tables: agent_task__* → routine__*
ALTER TABLE "agent_task__tasks" RENAME TO "routine__routines";--> statement-breakpoint
ALTER TABLE "agent_task__executions" RENAME TO "routine__executions";--> statement-breakpoint
ALTER TABLE "agent_task__steps" RENAME TO "routine__steps";--> statement-breakpoint
ALTER TABLE "agent_task__deliverables" RENAME TO "routine__deliverables";--> statement-breakpoint
ALTER TABLE "agent_task__interventions" RENAME TO "routine__interventions";--> statement-breakpoint
ALTER TABLE "agent_task__triggers" RENAME TO "routine__triggers";--> statement-breakpoint

-- Rename columns: task_id → routine_id, task_version → routine_version
-- (taskcast_task_id is intentionally NOT renamed)
ALTER TABLE "routine__executions" RENAME COLUMN "task_id" TO "routine_id";--> statement-breakpoint
ALTER TABLE "routine__executions" RENAME COLUMN "task_version" TO "routine_version";--> statement-breakpoint
ALTER TABLE "routine__steps" RENAME COLUMN "task_id" TO "routine_id";--> statement-breakpoint
ALTER TABLE "routine__deliverables" RENAME COLUMN "task_id" TO "routine_id";--> statement-breakpoint
ALTER TABLE "routine__interventions" RENAME COLUMN "task_id" TO "routine_id";--> statement-breakpoint
ALTER TABLE "routine__triggers" RENAME COLUMN "task_id" TO "routine_id";--> statement-breakpoint

-- Rename indexes on routine__routines (formerly agent_task__tasks)
ALTER INDEX "idx_agent_task__tasks_tenant_id" RENAME TO "idx_routine__routines_tenant_id";--> statement-breakpoint
ALTER INDEX "idx_agent_task__tasks_bot_id" RENAME TO "idx_routine__routines_bot_id";--> statement-breakpoint
ALTER INDEX "idx_agent_task__tasks_creator_id" RENAME TO "idx_routine__routines_creator_id";--> statement-breakpoint
ALTER INDEX "idx_agent_task__tasks_status" RENAME TO "idx_routine__routines_status";--> statement-breakpoint
ALTER INDEX "idx_agent_task__tasks_next_run_at" RENAME TO "idx_routine__routines_next_run_at";--> statement-breakpoint
ALTER INDEX "idx_agent_task__tasks_tenant_status" RENAME TO "idx_routine__routines_tenant_status";--> statement-breakpoint

-- Rename indexes on routine__executions (formerly agent_task__executions)
ALTER INDEX "idx_agent_task__executions_task_id" RENAME TO "idx_routine__executions_routine_id";--> statement-breakpoint
ALTER INDEX "idx_agent_task__executions_status" RENAME TO "idx_routine__executions_status";--> statement-breakpoint
ALTER INDEX "idx_agent_task__executions_task_version" RENAME TO "idx_routine__executions_routine_version";--> statement-breakpoint

-- Rename unique constraint on routine__executions
ALTER INDEX "uq_agent_task__executions_taskcast" RENAME TO "uq_routine__executions_taskcast";--> statement-breakpoint

-- Rename indexes on routine__steps (formerly agent_task__steps)
ALTER INDEX "idx_agent_task__steps_execution_id" RENAME TO "idx_routine__steps_execution_id";--> statement-breakpoint
ALTER INDEX "idx_agent_task__steps_task_id" RENAME TO "idx_routine__steps_routine_id";--> statement-breakpoint

-- Rename indexes on routine__deliverables (formerly agent_task__deliverables)
ALTER INDEX "idx_agent_task__deliverables_execution_id" RENAME TO "idx_routine__deliverables_execution_id";--> statement-breakpoint
ALTER INDEX "idx_agent_task__deliverables_task_id" RENAME TO "idx_routine__deliverables_routine_id";--> statement-breakpoint

-- Rename indexes on routine__interventions (formerly agent_task__interventions)
ALTER INDEX "idx_agent_task__interventions_execution_id" RENAME TO "idx_routine__interventions_execution_id";--> statement-breakpoint
ALTER INDEX "idx_agent_task__interventions_task_id" RENAME TO "idx_routine__interventions_routine_id";--> statement-breakpoint
ALTER INDEX "idx_agent_task__interventions_status" RENAME TO "idx_routine__interventions_status";--> statement-breakpoint

-- Rename indexes on routine__triggers (formerly agent_task__triggers)
ALTER INDEX "idx_agent_task__triggers_task_id" RENAME TO "idx_routine__triggers_routine_id";--> statement-breakpoint
ALTER INDEX "idx_agent_task__triggers_scan" RENAME TO "idx_routine__triggers_scan";--> statement-breakpoint

-- Rename foreign key constraints on routine__routines (formerly agent_task__tasks)
ALTER TABLE "routine__routines" RENAME CONSTRAINT "agent_task__tasks_tenant_id_tenants_id_fk" TO "routine__routines_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "routine__routines" RENAME CONSTRAINT "agent_task__tasks_bot_id_im_bots_id_fk" TO "routine__routines_bot_id_im_bots_id_fk";--> statement-breakpoint
ALTER TABLE "routine__routines" RENAME CONSTRAINT "agent_task__tasks_creator_id_im_users_id_fk" TO "routine__routines_creator_id_im_users_id_fk";--> statement-breakpoint
ALTER TABLE "routine__routines" RENAME CONSTRAINT "agent_task__tasks_document_id_documents_id_fk" TO "routine__routines_document_id_documents_id_fk";--> statement-breakpoint

-- Rename foreign key constraints on routine__executions (formerly agent_task__executions)
ALTER TABLE "routine__executions" RENAME CONSTRAINT "agent_task__executions_task_id_agent_task__tasks_id_fk" TO "routine__executions_routine_id_routine__routines_id_fk";--> statement-breakpoint
ALTER TABLE "routine__executions" RENAME CONSTRAINT "agent_task__executions_channel_id_im_channels_id_fk" TO "routine__executions_channel_id_im_channels_id_fk";--> statement-breakpoint
ALTER TABLE "routine__executions" RENAME CONSTRAINT "agent_task__executions_trigger_id_agent_task__triggers_id_fk" TO "routine__executions_trigger_id_routine__triggers_id_fk";--> statement-breakpoint
ALTER TABLE "routine__executions" RENAME CONSTRAINT "agent_task__executions_document_version_id_document_versions_id_fk" TO "routine__executions_document_version_id_document_versions_id_fk";--> statement-breakpoint

-- Rename foreign key constraints on routine__steps (formerly agent_task__steps)
ALTER TABLE "routine__steps" RENAME CONSTRAINT "agent_task__steps_execution_id_agent_task__executions_id_fk" TO "routine__steps_execution_id_routine__executions_id_fk";--> statement-breakpoint
ALTER TABLE "routine__steps" RENAME CONSTRAINT "agent_task__steps_task_id_agent_task__tasks_id_fk" TO "routine__steps_routine_id_routine__routines_id_fk";--> statement-breakpoint

-- Rename foreign key constraints on routine__deliverables (formerly agent_task__deliverables)
ALTER TABLE "routine__deliverables" RENAME CONSTRAINT "agent_task__deliverables_execution_id_agent_task__executions_id_fk" TO "routine__deliverables_execution_id_routine__executions_id_fk";--> statement-breakpoint
ALTER TABLE "routine__deliverables" RENAME CONSTRAINT "agent_task__deliverables_task_id_agent_task__tasks_id_fk" TO "routine__deliverables_routine_id_routine__routines_id_fk";--> statement-breakpoint

-- Rename foreign key constraints on routine__interventions (formerly agent_task__interventions)
ALTER TABLE "routine__interventions" RENAME CONSTRAINT "agent_task__interventions_execution_id_agent_task__executions_id_fk" TO "routine__interventions_execution_id_routine__executions_id_fk";--> statement-breakpoint
ALTER TABLE "routine__interventions" RENAME CONSTRAINT "agent_task__interventions_task_id_agent_task__tasks_id_fk" TO "routine__interventions_routine_id_routine__routines_id_fk";--> statement-breakpoint
ALTER TABLE "routine__interventions" RENAME CONSTRAINT "agent_task__interventions_step_id_agent_task__steps_id_fk" TO "routine__interventions_step_id_routine__steps_id_fk";--> statement-breakpoint
ALTER TABLE "routine__interventions" RENAME CONSTRAINT "agent_task__interventions_resolved_by_im_users_id_fk" TO "routine__interventions_resolved_by_im_users_id_fk";--> statement-breakpoint

-- Rename foreign key constraints on routine__triggers (formerly agent_task__triggers)
ALTER TABLE "routine__triggers" RENAME CONSTRAINT "agent_task__triggers_task_id_agent_task__tasks_id_fk" TO "routine__triggers_routine_id_routine__routines_id_fk";--> statement-breakpoint

-- Rename column and foreign key constraints on resource_usage_logs
ALTER TABLE "resource_usage_logs" RENAME COLUMN "task_id" TO "routine_id";--> statement-breakpoint
ALTER TABLE "resource_usage_logs" RENAME CONSTRAINT "resource_usage_logs_task_id_agent_task__tasks_id_fk" TO "resource_usage_logs_routine_id_routine__routines_id_fk";--> statement-breakpoint
ALTER TABLE "resource_usage_logs" RENAME CONSTRAINT "resource_usage_logs_execution_id_agent_task__executions_id_fk" TO "resource_usage_logs_execution_id_routine__executions_id_fk";--> statement-breakpoint

-- Rename primary key constraints (auto-generated by PostgreSQL)
ALTER TABLE "routine__routines" RENAME CONSTRAINT "agent_task__tasks_pkey" TO "routine__routines_pkey";--> statement-breakpoint
ALTER TABLE "routine__executions" RENAME CONSTRAINT "agent_task__executions_pkey" TO "routine__executions_pkey";--> statement-breakpoint
ALTER TABLE "routine__steps" RENAME CONSTRAINT "agent_task__steps_pkey" TO "routine__steps_pkey";--> statement-breakpoint
ALTER TABLE "routine__deliverables" RENAME CONSTRAINT "agent_task__deliverables_pkey" TO "routine__deliverables_pkey";--> statement-breakpoint
ALTER TABLE "routine__interventions" RENAME CONSTRAINT "agent_task__interventions_pkey" TO "routine__interventions_pkey";--> statement-breakpoint
ALTER TABLE "routine__triggers" RENAME CONSTRAINT "agent_task__triggers_pkey" TO "routine__triggers_pkey";
