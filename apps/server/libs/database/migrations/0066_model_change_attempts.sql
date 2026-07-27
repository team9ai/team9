CREATE TYPE "public"."model_change_decision" AS ENUM('accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."model_change_dispatch_status" AS ENUM('not_applicable', 'pending', 'dispatching', 'dispatched', 'failed');--> statement-breakpoint
CREATE TYPE "public"."model_change_outbox_status" AS ENUM('pending', 'processing', 'dispatched', 'failed');--> statement-breakpoint
CREATE TABLE "im_model_change_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"actor_user_id" uuid,
	"auth_session_id" varchar(128),
	"correlation_id" varchar(128),
	"tenant_id" uuid,
	"channel_id" uuid,
	"bot_id" uuid,
	"installed_application_id" uuid,
	"application_id" varchar(255),
	"session_id" varchar(512),
	"requested_provider" varchar(128) NOT NULL,
	"requested_model_id" varchar(256) NOT NULL,
	"capability" varchar(64),
	"catalog_version" varchar(64),
	"decision" "model_change_decision" NOT NULL,
	"reason_code" varchar(64) NOT NULL,
	"dispatch_status" "model_change_dispatch_status" NOT NULL,
	"safe_error_code" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"dispatched_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "im_model_change_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"attempt_id" uuid NOT NULL,
	"status" "model_change_outbox_status" DEFAULT 'pending' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"claim_token" uuid,
	"claim_until" timestamp,
	"safe_error_code" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "im_model_change_attempts" ADD CONSTRAINT "im_model_change_attempts_actor_user_id_im_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."im_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_model_change_attempts" ADD CONSTRAINT "im_model_change_attempts_channel_id_im_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."im_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_model_change_attempts" ADD CONSTRAINT "im_model_change_attempts_bot_id_im_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."im_bots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_model_change_attempts" ADD CONSTRAINT "im_model_change_attempts_installed_application_id_im_installed_applications_id_fk" FOREIGN KEY ("installed_application_id") REFERENCES "public"."im_installed_applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_model_change_outbox" ADD CONSTRAINT "im_model_change_outbox_attempt_id_im_model_change_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."im_model_change_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_model_change_attempts_idempotency" ON "im_model_change_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_model_change_attempts_actor_created" ON "im_model_change_attempts" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_model_change_attempts_tenant_created" ON "im_model_change_attempts" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_model_change_attempts_decision_reason" ON "im_model_change_attempts" USING btree ("decision","reason_code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_model_change_outbox_attempt" ON "im_model_change_outbox" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "idx_model_change_outbox_due" ON "im_model_change_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_model_change_outbox_claim" ON "im_model_change_outbox" USING btree ("status","claim_until");
