CREATE TABLE "blueprints" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "blueprints_name_idx" ON "blueprints" USING btree ("name");--> statement-breakpoint
CREATE INDEX "blueprints_created_at_idx" ON "blueprints" USING btree ("created_at");