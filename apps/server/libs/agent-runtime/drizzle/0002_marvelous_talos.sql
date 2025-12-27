CREATE TABLE "agents" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"blueprint_id" varchar(64),
	"name" varchar(255) NOT NULL,
	"thread_id" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'running' NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agents_blueprint_id_idx" ON "agents" USING btree ("blueprint_id");--> statement-breakpoint
CREATE INDEX "agents_thread_id_idx" ON "agents" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "agents_status_idx" ON "agents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agents_created_at_idx" ON "agents" USING btree ("created_at");