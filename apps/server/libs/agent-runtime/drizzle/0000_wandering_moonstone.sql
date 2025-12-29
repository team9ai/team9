CREATE TABLE "memory_chunks" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"thread_id" varchar(64),
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_states" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"thread_id" varchar(64),
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_threads" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "memory_chunks_thread_id_idx" ON "memory_chunks" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "memory_chunks_created_at_idx" ON "memory_chunks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "memory_states_thread_id_idx" ON "memory_states" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "memory_states_created_at_idx" ON "memory_states" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "memory_threads_created_at_idx" ON "memory_threads" USING btree ("created_at");