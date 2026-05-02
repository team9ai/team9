CREATE TYPE "public"."permission_grant_source" AS ENUM('proactive', 'request_approved');--> statement-breakpoint
CREATE TYPE "public"."permission_subject_kind" AS ENUM('agent', 'channel-session', 'execution-session', 'task');--> statement-breakpoint
CREATE TYPE "public"."permission_request_status" AS ENUM('pending', 'approved_once', 'approved_durable', 'denied', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "auth_permission_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"granted_by_user_id" uuid NOT NULL,
	"subject_kind" "permission_subject_kind" NOT NULL,
	"subject_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	"scope_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" "permission_grant_source" NOT NULL,
	"request_id" uuid,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_permission_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spell_id" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requester_bot_id" uuid NOT NULL,
	"context_channel_id" uuid,
	"context_execution_id" uuid,
	"context_routine_id" uuid,
	"permission_key" text NOT NULL,
	"requested_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"suggested_approver_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"reason" text,
	"status" "permission_request_status" DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"durable_grant_id" uuid,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_permission_grants" ADD CONSTRAINT "auth_permission_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_permission_grants" ADD CONSTRAINT "auth_permission_grants_granted_by_user_id_im_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."im_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_permission_grants" ADD CONSTRAINT "auth_permission_grants_request_id_auth_permission_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."auth_permission_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_permission_grants" ADD CONSTRAINT "auth_permission_grants_revoked_by_user_id_im_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."im_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_permission_requests" ADD CONSTRAINT "auth_permission_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_permission_requests" ADD CONSTRAINT "auth_permission_requests_requester_bot_id_im_bots_id_fk" FOREIGN KEY ("requester_bot_id") REFERENCES "public"."im_bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_permission_requests" ADD CONSTRAINT "auth_permission_requests_context_channel_id_im_channels_id_fk" FOREIGN KEY ("context_channel_id") REFERENCES "public"."im_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_permission_requests" ADD CONSTRAINT "auth_permission_requests_context_execution_id_routine__executions_id_fk" FOREIGN KEY ("context_execution_id") REFERENCES "public"."routine__executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_permission_requests" ADD CONSTRAINT "auth_permission_requests_context_routine_id_routine__routines_id_fk" FOREIGN KEY ("context_routine_id") REFERENCES "public"."routine__routines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_permission_requests" ADD CONSTRAINT "auth_permission_requests_decided_by_user_id_im_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."im_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_grants_subject_idx" ON "auth_permission_grants" USING btree ("tenant_id","subject_kind","subject_id","permission_key");--> statement-breakpoint
CREATE INDEX "auth_grants_active_idx" ON "auth_permission_grants" USING btree ("tenant_id","permission_key") WHERE "auth_permission_grants"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_req_spell_idx" ON "auth_permission_requests" USING btree ("spell_id");--> statement-breakpoint
CREATE INDEX "auth_req_pending_bot_idx" ON "auth_permission_requests" USING btree ("tenant_id","requester_bot_id","status");--> statement-breakpoint
CREATE INDEX "auth_req_pending_ctx_idx" ON "auth_permission_requests" USING btree ("tenant_id","context_channel_id","status");