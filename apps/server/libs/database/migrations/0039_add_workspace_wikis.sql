CREATE TYPE "public"."wiki_approval_mode" AS ENUM('auto', 'review');--> statement-breakpoint
CREATE TYPE "public"."wiki_permission_level" AS ENUM('read', 'propose', 'write');--> statement-breakpoint
CREATE TABLE "workspace_wikis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"folder9_folder_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"approval_mode" "wiki_approval_mode" DEFAULT 'auto' NOT NULL,
	"human_permission" "wiki_permission_level" DEFAULT 'write' NOT NULL,
	"agent_permission" "wiki_permission_level" DEFAULT 'read' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_wikis_workspace_slug_unique" ON "workspace_wikis" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_wikis_folder9_unique" ON "workspace_wikis" USING btree ("folder9_folder_id");--> statement-breakpoint
CREATE INDEX "workspace_wikis_workspace_idx" ON "workspace_wikis" USING btree ("workspace_id");
