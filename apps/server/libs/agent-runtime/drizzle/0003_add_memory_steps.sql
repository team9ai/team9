CREATE TABLE "memory_steps" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"thread_id" varchar(64) NOT NULL,
	"status" varchar(32) NOT NULL,
	"data" jsonb NOT NULL,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "memory_steps_thread_id_idx" ON "memory_steps" USING btree ("thread_id");
--> statement-breakpoint
CREATE INDEX "memory_steps_status_idx" ON "memory_steps" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "memory_steps_started_at_idx" ON "memory_steps" USING btree ("started_at");